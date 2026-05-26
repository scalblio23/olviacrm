import { z } from "zod";
import { nanoid } from "nanoid";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { parseDate } from "@shared/parseDate";
import { normalizeAuPhone } from "@shared/phone";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { createHeartbeatJob } from "./_core/heartbeat";
import { sendEmail, buildInviteEmailHtml, buildFollowUp1Html, buildReminderHtml } from "./mailgun";
import {
  createLeadSession,
  getLatestLeadSession,
  insertLeads,
  getLeadsBySession,
  getLeadById,
  updateLeadDisposition,
  updateLeadNotes,
  insertCallHistory,
  getCallHistoryByLead,
  getCallHistoryByPhone,
  getAllCallHistory,
  insertSmsMessage,
  getSmsThread,
  upsertContact,
  listContacts,
  getContactByPhone,
  deleteContact,
  bulkDeleteContacts,
  bulkAddTagToContacts,
  getActiveContactPhones,
  removeTagFromContact,
  updateContactStatus,
  bulkUpdateContactStatus,
  updateContactOutcome,
  updateContactDealResult,
  listTags,
  createTag,
  getUserPreferences,
  updateUserPreferences,
  deleteTag,
  getTagsForContact,
  setContactTags,
  listSmartlists,
  createSmartlist,
  deleteSmartlist,
  shareSmartlist,
  listUsers,
  setUserRole,
  getUserPermittedTagIds,
  getAllUserTagPermissions,
  setUserTagPermissions,
  getUserByEmail,
  createCustomUser,
  getUserByInviteToken,
  clearInviteToken,
  updateUserPasswordHash,
  deleteUser,
  updateUserInviteStep,
  listEmailMessages,
  listAutomations,
  getAutomationById,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  replaceAutomationSteps,
  getAutomationSteps,
  enrollContact,
  listEnrollmentsForAutomation,
  updateEnrollment,
  getAutomationsForTag,
  getAutomationsForAppointmentBooked,
  getContactById,
  listCalendars,
  createCalendar,
  updateCalendar,
  deleteCalendar,
  listAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getAppSetting,
  setAppSetting,
  normalisePhone,
  updateContactById,
  getExecutionLogs,
  countExecutionLogs,
  listUpdates,
  getDismissedUpdateIds,
  createUpdate,
  updateUpdate,
  deleteUpdate,
  dismissUpdatesForUser,
} from "./db";

// ─── Telnyx helpers ──────────────────────────────────────────────────────────

const TELNYX_API_KEY       = process.env.TELNYX_API_KEY ?? "";
const TELNYX_FROM_NUMBER   = process.env.TELNYX_FROM_NUMBER ?? "+61485825732";
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID ?? "";

// Logs the full Telnyx error payload (errors[] with code/title/detail/source)
// to the server logs and returns an Error whose message surfaces those details
// to the frontend instead of a bare status code.
function telnyxError(
  context: string,
  status: number,
  json: Record<string, unknown>,
  raw: string,
): Error {
  const errors = Array.isArray(json?.errors)
    ? (json.errors as Array<Record<string, unknown>>)
    : [];

  console.error(
    `[Telnyx] ${context} failed (HTTP ${status}):`,
    errors.length ? JSON.stringify(errors, null, 2) : raw || "(empty body)",
  );

  const summary = errors.length
    ? errors
        .map((e) => {
          const parts = [
            e.code != null ? `code ${e.code}` : null,
            e.title,
            e.detail,
          ].filter(Boolean);
          return parts.length ? parts.join(": ") : JSON.stringify(e);
        })
        .join("; ")
    : raw || `HTTP ${status}`;

  return new Error(`Telnyx ${context} error ${status}: ${summary}`);
}

async function telnyxPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TELNYX_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON body — leave json empty; raw is preserved for logging.
  }
  if (!res.ok) {
    throw telnyxError(`POST ${path}`, res.status, json, raw);
  }
  return json;
}

// ─── Blooio helpers ─────────────────────────────────────────────────────────────────

const BLOOIO_API_KEY = process.env.BLOOIO_API_KEY ?? "";

async function blooioSend(to: string, text: string): Promise<{ message_id: string; status: string }> {
  const encoded = encodeURIComponent(to);
  const res = await fetch(`https://backend.blooio.com/v2/api/chats/${encoded}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BLOOIO_API_KEY}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Blooio send failed (${res.status}): ${JSON.stringify(err)}`);
  }
  return res.json() as Promise<{ message_id: string; status: string }>;
}

// ─── Disposition enum ─────────────────────────────────────────────────────────────────

const dispositionEnum = z.enum([
  "none",
  "answered",
  "no_answer",
  "callback",
  "appointment_set",
]);

// ─── Router ───────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  // Per-user UI preferences (extensible JSON bag stored on the user row).
  preferences: router({
    get: protectedProcedure.query(({ ctx }) => getUserPreferences(ctx.user.id)),
    update: protectedProcedure
      .input(z.record(z.string(), z.unknown()))
      .mutation(({ ctx, input }) => updateUserPreferences(ctx.user.id, input)),
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByEmail(input.email);
        if (!user || !user.passwordHash) {
          throw new Error('Invalid email or password');
        }
        const valid = await bcrypt.compare(input.password, user.passwordHash);
        if (!valid) throw new Error('Invalid email or password');
        const token = await sdk.createSessionToken(user.openId, { name: user.name ?? '' });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, cookieOptions);
        return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
      }),
    acceptInvite: publicProcedure
      .input(z.object({
        token: z.string(),
        password: z.string().min(6),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByInviteToken(input.token);
        if (!user) throw new Error('Invalid or expired invite link');
        const hash = await bcrypt.hash(input.password, 10);
        await updateUserPasswordHash(user.id, hash);
        await clearInviteToken(user.id);
        const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? '' });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, cookieOptions);
        return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
      }),
  }),

  // ─── Leads ────────────────────────────────────────────────────────────────
  leads: router({
    upload: publicProcedure
      .input(
        z.object({
          fileName: z.string(),
          tagId: z.number().optional(),
          rows: z.array(
            z.object({
              name:      z.string().optional(),
              phone:     z.string(),
              company:   z.string().optional(),
              email:     z.string().optional(),
              source:    z.string().optional(),
              criteria1: z.string().optional(),
              criteria2: z.string().optional(),
              criteria3: z.string().optional(),
              criteria4: z.string().optional(),
              criteria5: z.string().optional(),
              closer:           z.string().optional(),
              priceQuoted:      z.string().optional(),
              callRecordingUrl: z.string().optional(),
              objections:       z.string().optional(),
              dealResult:       z.string().optional(),
              status:    z.string().optional(),
              tags:      z.array(z.string()).optional(),
              createdAt: z.string().optional(),
              extraData: z.record(z.string(), z.string()).optional(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const sessionId = nanoid(16);
        await createLeadSession(sessionId, input.fileName, input.tagId);
        // Normalize phones to E.164 (AU default) and skip any that can't be normalized.
        const validRows = input.rows
          .map((r) => ({ ...r, phone: normalizeAuPhone(r.phone) }))
          .filter((r): r is typeof r & { phone: string } => r.phone !== null);
        const skipped = input.rows.length - validRows.length;
        const leadRows = validRows.map((r) => ({
          sessionId,
          name:      r.name    ?? null,
          phone:     r.phone,
          company:   r.company ?? null,
          extraData: r.extraData ?? null,
        }));
        await insertLeads(leadRows);
        // Resolve per-row tag names to ids, creating tags that don't exist yet.
        // Cache is built lazily so uploads without a Tags column never hit the tags table.
        let tagCache: Map<string, number> | null = null;
        const resolveTagIds = async (names: string[]): Promise<number[]> => {
          if (!tagCache) {
            tagCache = new Map<string, number>();
            for (const t of await listTags()) tagCache.set(t.name.toLowerCase(), t.id);
          }
          const ids: number[] = [];
          for (const raw of names) {
            const name = raw.trim();
            if (!name) continue;
            const key = name.toLowerCase();
            let id = tagCache.get(key);
            if (id === undefined) {
              const created = await createTag({ name });
              id = created.id;
              tagCache.set(key, id);
            }
            if (!ids.includes(id)) ids.push(id);
          }
          return ids;
        };
        // Mirror each lead into the contacts table and link the tag
        const CHUNK = 20;
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < validRows.length; i += CHUNK) {
          const chunk = validRows.slice(i, i + CHUNK);
          const contactIds: number[] = [];
          for (const r of chunk) {
            const contact = await upsertContact({
              phone:     r.phone,
              name:      r.name      ?? "",
              email:     r.email     ?? null,
              company:   r.company   ?? null,
              source:    r.source    ?? null,
              criteria1: r.criteria1 ?? null,
              criteria2: r.criteria2 ?? null,
              criteria3: r.criteria3 ?? null,
              criteria4: r.criteria4 ?? null,
              criteria5: r.criteria5 ?? null,
              // Pass through only when the CSV mapped them, so re-imports preserve existing values.
              closer:           r.closer,
              priceQuoted:      r.priceQuoted,
              callRecordingUrl: r.callRecordingUrl,
              objections:       r.objections,
              dealResult:       r.dealResult,
              status:    r.status || undefined,
              notes:     null,
              ...(r.createdAt ? (() => { const d = parseDate(r.createdAt); return d ? { createdAt: d } : {}; })() : {}),
            });
            if (contact?.id) {
              contactIds.push(contact.id);
              // Apply per-row tags (from a CSV column mapped to Tags), creating any that are missing.
              if (r.tags && r.tags.length > 0) {
                const tagIds = await resolveTagIds(r.tags);
                for (const tagId of tagIds) await bulkAddTagToContacts([contact.id], tagId);
              }
            }
          }
          if (input.tagId && contactIds.length > 0) {
            await bulkAddTagToContacts(contactIds, input.tagId);
          }
          if (i + CHUNK < validRows.length) await sleep(150);
        }
        return { sessionId, imported: validRows.length, skipped };
      }),

    list: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        return getLeadsBySession(input.sessionId);
      }),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getLeadById(input.id);
      }),

    setDisposition: publicProcedure
      .input(z.object({ id: z.number(), disposition: dispositionEnum }))
      .mutation(async ({ input }) => {
        await updateLeadDisposition(input.id, input.disposition);
        return { success: true };
      }),

    setNotes: publicProcedure
      .input(z.object({ id: z.number(), notes: z.string() }))
      .mutation(async ({ input }) => {
        await updateLeadNotes(input.id, input.notes);
        return { success: true };
      }),

    logCall: publicProcedure
      .input(z.object({
        leadId:          z.number().optional(),
        sessionId:       z.string().optional(),
        phone:           z.string(),
        contactName:     z.string().optional(),
        direction:       z.enum(["outbound", "inbound"]).default("outbound"),
        durationSeconds: z.number().int().min(0),
        disposition:     dispositionEnum,
        startedAt:       z.number(),
      }))
      .mutation(async ({ input }) => {
        await insertCallHistory({
          leadId:          input.leadId ?? null,
          sessionId:       input.sessionId ?? null,
          phone:           input.phone,
          contactName:     input.contactName ?? null,
          direction:       input.direction,
          durationSeconds: input.durationSeconds,
          disposition:     input.disposition,
          startedAt:       new Date(input.startedAt),
        });
        return { success: true };
      }),

    getCallHistory: publicProcedure
      .input(z.object({ leadId: z.number() }))
      .query(async ({ input }) => {
        return getCallHistoryByLead(input.leadId);
      }),

    getCallHistoryByPhone: publicProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        return getCallHistoryByPhone(input.phone);
      }),

    getAllCallHistory: publicProcedure
      .query(async () => {
        return getAllCallHistory(200);
      }),

    getLatestSession: publicProcedure
      .query(async () => {
        return getLatestLeadSession();
      }),
  }),

  // ─── Telnyx ───────────────────────────────────────────────────────────────
  telnyx: router({
    sms: publicProcedure
      .input(z.object({ to: z.string(), text: z.string().min(1).max(1600) }))
      .mutation(async ({ input }) => {
        if (!TELNYX_API_KEY) throw new Error("Telnyx API key not configured");
        const normTo = normalisePhone(input.to);
        const result = await telnyxPost("/messages", {
          from: TELNYX_FROM_NUMBER,
          to:   normTo,
          text: input.text,
        });
        const msgId = (result?.data as Record<string, unknown>)?.id as string | undefined;
        await insertSmsMessage({
          phone:      normTo,
          direction:  "outbound",
          body:       input.text,
          status:     "sent",
          externalId: msgId ?? null,
        });
        return { success: true };
      }),

    getSmsThread: publicProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        return getSmsThread(input.phone);
      }),

    getWebRTCToken: publicProcedure.mutation(async () => {
      if (!TELNYX_API_KEY) throw new Error("Telnyx API key not configured");
      const webrtcConnId = process.env.TELNYX_WEBRTC_CONNECTION_ID ?? "";
      if (!webrtcConnId) throw new Error("TELNYX_WEBRTC_CONNECTION_ID not configured");
      const credRes  = await telnyxPost("/telephony_credentials", {
        connection_id: webrtcConnId,
        name: `loop-agent-${Date.now()}`,
      });
      const credData = credRes?.data as Record<string, unknown>;
      const credId   = credData?.id as string;
      if (!credId) throw new Error("Failed to create telephony credential");
      const tokenRes = await fetch(
        `https://api.telnyx.com/v2/telephony_credentials/${credId}/token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TELNYX_API_KEY}`,
          },
        }
      );
      if (!tokenRes.ok) {
        const raw = await tokenRes.text();
        let json: Record<string, unknown> = {};
        try {
          json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          // Non-JSON body — leave json empty; raw is preserved for logging.
        }
        throw telnyxError(
          `POST /telephony_credentials/${credId}/token`,
          tokenRes.status,
          json,
          raw,
        );
      }
      const token = await tokenRes.text();
      return {
        token: token.replace(/"/g, "").trim(),
        credentialId: credId,
        fromNumber: TELNYX_FROM_NUMBER,
      };
    }),

    validateCredentials: publicProcedure.query(() => {
      return {
        hasApiKey:        !!TELNYX_API_KEY,
        hasFromNumber:    !!TELNYX_FROM_NUMBER,
        hasConnectionId:  !!TELNYX_CONNECTION_ID,
        fromNumber:       TELNYX_FROM_NUMBER,
      };
    }),

    sendMessage: publicProcedure
      .input(z.object({ to: z.string(), text: z.string() }))
      .mutation(async ({ input }) => {
        const normTo = normalisePhone(input.to);
        const result = await telnyxPost("/messages", {
          from: TELNYX_FROM_NUMBER,
          to:   normTo,
          text: input.text,
          messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
        });
        await insertSmsMessage({
          phone:     normTo,
          direction: "outbound",
          body:      input.text,
          status:    "sent",
        });
        return result;
      }),
  }),

  // ─── Blooio (iMessage) ─────────────────────────────────────────────────────
  blooio: router({
    send: publicProcedure
      .input(z.object({ to: z.string(), text: z.string().min(1).max(10000) }))
      .mutation(async ({ input }) => {
        if (!BLOOIO_API_KEY) throw new Error("Blooio API key not configured");
        const result = await blooioSend(input.to, input.text);
        await insertSmsMessage({
          phone:      input.to,
          direction:  "outbound",
          body:       input.text,
          status:     "sent",
          externalId: result.message_id ?? null,
          channel:    "imessage",
        });
        return { success: true, messageId: result.message_id };
      }),
  }),

  // ─── Tags ─────────────────────────────────────────────────────────────────
  tags: router({
    list: publicProcedure.query(async () => {
      return listTags();
    }),
    create: publicProcedure
      .input(z.object({
        name:  z.string().min(1).max(100),
        color: z.string().max(32).optional(),
      }))
      .mutation(async ({ input }) => {
        const tag = await createTag({
          name:  input.name,
          color: input.color ?? "#6366f1",
        });
        return tag;
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteTag(input.id);
        return { success: true };
      }),
  }),

  // ─── Contacts ─────────────────────────────────────────────────────────────
  contacts: router({
    list: publicProcedure
      .input(z.object({
        dateFrom: z.number().optional(),
        dateTo:   z.number().optional(),
        tagIds:   z.array(z.number()).optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        const user = (ctx as any).user;
        let effectiveTagIds = input?.tagIds;
        if (user && user.role !== 'admin') {
          const permittedTagIds = await getUserPermittedTagIds(user.id);
          if (permittedTagIds.length > 0) {
            effectiveTagIds = input?.tagIds
              ? input.tagIds.filter((id: number) => permittedTagIds.includes(id))
              : permittedTagIds;
            if (effectiveTagIds.length === 0) return [];
          } else {
            return [];
          }
        }
        return listContacts({
          dateFrom: input?.dateFrom ? new Date(input.dateFrom) : undefined,
          dateTo:   input?.dateTo   ? new Date(input.dateTo)   : undefined,
          tagIds:   effectiveTagIds,
        });
      }),
    getActivePhones: publicProcedure
      .query(async () => {
        return getActiveContactPhones();
      }),
    bulkDelete: publicProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        await bulkDeleteContacts(input.ids);
        return { success: true, deleted: input.ids.length };
      }),
    bulkAddTag: publicProcedure
      .input(z.object({
        contactIds: z.array(z.number()).min(1),
        tagId:      z.number(),
      }))
      .mutation(async ({ input }) => {
        await bulkAddTagToContacts(input.contactIds, input.tagId);
        return { success: true };
      }),
    removeTag: publicProcedure
      .input(z.object({ contactId: z.number(), tagId: z.number() }))
      .mutation(async ({ input }) => {
        await removeTagFromContact(input.contactId, input.tagId);
        return { success: true };
      }),
    bulkRemoveTag: publicProcedure
      .input(z.object({
        contactIds: z.array(z.number()).min(1),
        tagId:      z.number(),
      }))
      .mutation(async ({ input }) => {
        for (const contactId of input.contactIds) {
          await removeTagFromContact(contactId, input.tagId);
        }
        return { success: true };
      }),
    setOutcome: publicProcedure
      .input(z.object({ contactId: z.number(), outcome: z.string().nullable() }))
      .mutation(async ({ input }) => {
        await updateContactOutcome(input.contactId, input.outcome);
        return { success: true };
      }),
    setStatus: publicProcedure
      .input(z.object({
        contactId: z.number(),
        status:    z.string().max(64).nullable(),
      }))
      .mutation(async ({ input }) => {
        await updateContactStatus(input.contactId, input.status);
        return { success: true };
      }),
    setDealResult: publicProcedure
      .input(z.object({
        contactId:  z.number(),
        dealResult: z.string().max(16).nullable(),
      }))
      .mutation(async ({ input }) => {
        await updateContactDealResult(input.contactId, input.dealResult);
        return { success: true };
      }),
    bulkSetStatus: publicProcedure
      .input(z.object({
        contactIds: z.array(z.number()).min(1),
        status:     z.string().max(64).nullable(),
      }))
      .mutation(async ({ input }) => {
        await bulkUpdateContactStatus(input.contactIds, input.status);
        return { success: true };
      }),
    getByPhone: publicProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        return getContactByPhone(input.phone);
      }),
    getTagsForContact: publicProcedure
      .input(z.object({ contactId: z.number() }))
      .query(async ({ input }) => {
        return getTagsForContact(input.contactId);
      }),
    upsert: publicProcedure
      .input(z.object({
        name:      z.string().min(1).max(255),
        phone:     z.string().min(1).max(64),
        email:     z.string().email().optional().or(z.literal("")),
        company:   z.string().max(255).optional(),
        notes:     z.string().max(5000).optional(),
        source:    z.string().max(255).optional(),
        criteria1: z.string().max(255).optional(),
        criteria2: z.string().max(255).optional(),
        criteria3: z.string().max(255).optional(),
        criteria4: z.string().max(255).optional(),
        criteria5: z.string().max(255).optional(),
        tagIds:    z.array(z.number()).optional(),
        status:    z.string().max(64).optional(),
        outcome:   z.string().optional(),
        timezone:  z.string().max(64).optional(),
        closer:           z.string().max(255).optional(),
        priceQuoted:      z.string().max(64).optional(),
        callRecordingUrl: z.string().max(1024).optional(),
        objections:       z.string().optional(),
        dealResult:       z.string().max(16).optional(),
      }))
      .mutation(async ({ input }) => {
        const phone = normalizeAuPhone(input.phone);
        if (!phone) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phone number — could not normalize to a valid format." });
        }
        const contact = await upsertContact({
          name:      input.name,
          phone:     phone,
          email:     input.email || null,
          company:   input.company || null,
          notes:     input.notes || null,
          source:    input.source || null,
          criteria1: input.criteria1 || null,
          criteria2: input.criteria2 || null,
          criteria3: input.criteria3 || null,
          criteria4: input.criteria4 || null,
          criteria5: input.criteria5 || null,
          status:    input.status || null,
          outcome:   input.outcome !== undefined ? (input.outcome || null) : undefined,
          timezone:  input.timezone || null,
          closer:           input.closer           !== undefined ? (input.closer           || null) : undefined,
          priceQuoted:      input.priceQuoted      !== undefined ? (input.priceQuoted      || null) : undefined,
          callRecordingUrl: input.callRecordingUrl !== undefined ? (input.callRecordingUrl || null) : undefined,
          objections:       input.objections       !== undefined ? (input.objections       || null) : undefined,
          dealResult:       input.dealResult       !== undefined ? (input.dealResult       || null) : undefined,
        });
        if (input.tagIds !== undefined) {
          await setContactTags(contact.id, input.tagIds);
        }
        return { success: true, contact };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteContact(input.id);
        return { success: true };
      }),
    setTags: publicProcedure
      .input(z.object({
        contactId: z.number(),
        tagIds:    z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        await setContactTags(input.contactId, input.tagIds);
        return { success: true };
      }),
    // AI-assisted contact creation — parse natural language into contact fields
    aiChat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })),
      }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import("./_core/llm");

        // ── Tool definitions ──────────────────────────────────────────────────
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "search_contacts",
              description: "Search contacts by name, phone, or email. Returns a list of matching contacts with all their fields and current tags.",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search term (name, phone, or email)" },
                },
                required: ["query"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "get_contact",
              description: "Get full details of a contact by their ID, including all fields and tags.",
              parameters: {
                type: "object",
                properties: {
                  contact_id: { type: "number", description: "The contact ID" },
                },
                required: ["contact_id"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "add_contact",
              description: "Add a new contact or update an existing one (matched by phone). Phone is required.",
              parameters: {
                type: "object",
                properties: {
                  phone:     { type: "string",  description: "Phone in E.164 format e.g. +61412345678" },
                  name:      { type: "string",  description: "Full name" },
                  email:     { type: "string",  description: "Email address" },
                  company:   { type: "string",  description: "Company name" },
                  source:    { type: "string",  description: "Lead source" },
                  timezone:  { type: "string",  description: "IANA timezone e.g. Australia/Sydney" },
                  notes:     { type: "string",  description: "Notes" },
                  criteria1: { type: "string",  description: "Custom criteria 1" },
                  criteria2: { type: "string",  description: "Custom criteria 2" },
                  criteria3: { type: "string",  description: "Custom criteria 3" },
                  criteria4: { type: "string",  description: "Custom criteria 4" },
                  criteria5: { type: "string",  description: "Custom criteria 5" },
                },
                required: ["phone"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "edit_contact",
              description: "Edit one or more fields on an existing contact by ID. Only provided fields are updated.",
              parameters: {
                type: "object",
                properties: {
                  contact_id: { type: "number",  description: "The contact ID" },
                  name:       { type: "string",  description: "Full name" },
                  email:      { type: "string",  description: "Email address" },
                  company:    { type: "string",  description: "Company name" },
                  source:     { type: "string",  description: "Lead source" },
                  timezone:   { type: "string",  description: "IANA timezone" },
                  notes:      { type: "string",  description: "Notes" },
                  criteria1:  { type: "string",  description: "Custom criteria 1" },
                  criteria2:  { type: "string",  description: "Custom criteria 2" },
                  criteria3:  { type: "string",  description: "Custom criteria 3" },
                  criteria4:  { type: "string",  description: "Custom criteria 4" },
                  criteria5:  { type: "string",  description: "Custom criteria 5" },
                },
                required: ["contact_id"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "set_status",
              description: "Set the status of a contact. Valid statuses: New, Contacted, Interested, Not Interested, Appointment Set, Converted, Lost.",
              parameters: {
                type: "object",
                properties: {
                  contact_id: { type: "number", description: "The contact ID" },
                  status:     { type: "string", description: "New status value" },
                },
                required: ["contact_id", "status"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "list_tags",
              description: "List all available tags in the system.",
              parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "add_tag",
              description: "Add a tag to a contact by contact ID and tag ID.",
              parameters: {
                type: "object",
                properties: {
                  contact_id: { type: "number", description: "The contact ID" },
                  tag_id:     { type: "number", description: "The tag ID to add" },
                },
                required: ["contact_id", "tag_id"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "remove_tag",
              description: "Remove a tag from a contact by contact ID and tag ID.",
              parameters: {
                type: "object",
                properties: {
                  contact_id: { type: "number", description: "The contact ID" },
                  tag_id:     { type: "number", description: "The tag ID to remove" },
                },
                required: ["contact_id", "tag_id"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "create_tag",
              description: "Create a new tag with a name and colour.",
              parameters: {
                type: "object",
                properties: {
                  name:  { type: "string", description: "Tag name" },
                  color: { type: "string", description: "Hex colour e.g. #6366f1" },
                },
                required: ["name", "color"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "search_contacts_by_tag",
              description: "Find all contacts that have a specific tag. Accepts a tag name (partial match) or tag ID. Returns matching contacts with their fields and all tags.",
              parameters: {
                type: "object",
                properties: {
                  tag_name: { type: "string", description: "Tag name to search for (partial match, case-insensitive)" },
                  tag_id:   { type: "number", description: "Tag ID (use instead of tag_name if you already know the ID)" },
                },
                required: [],
                additionalProperties: false,
              },
            },
          },
        ];

        // ── Tool executor ─────────────────────────────────────────────────────
        async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
          try {
            if (name === "search_contacts") {
              const q = ((args.query as string) || "").toLowerCase();
              const all = await listContacts({});
              const matches = all.filter(c =>
                (c.name ?? "").toLowerCase().includes(q) ||
                (c.phone ?? "").includes(q) ||
                (c.email ?? "").toLowerCase().includes(q)
              ).slice(0, 10);
              // Return only essential fields to keep context small
              return JSON.stringify(matches.map(c => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, company: c.company, timezone: c.timezone, criteria1: c.criteria1, criteria2: c.criteria2, criteria3: c.criteria3, criteria4: c.criteria4, criteria5: c.criteria5, status: c.status, tags: c.tags.map(t => ({ id: t.id, name: t.name })) })));
            }
            if (name === "get_contact") {
              const c = await getContactById(args.contact_id as number);
              if (!c) return JSON.stringify({ error: "Contact not found" });
              const contactTags = await getTagsForContact(c.id);
              return JSON.stringify({ ...c, tags: contactTags });
            }
            if (name === "add_contact") {
              const phone = normalisePhone(args.phone as string);
              const contact = await upsertContact({
                phone,
                name:      (args.name as string) || "Unknown",
                email:     (args.email as string) || null,
                company:   (args.company as string) || null,
                source:    (args.source as string) || null,
                timezone:  (args.timezone as string) || null,
                notes:     (args.notes as string) || null,
                criteria1: (args.criteria1 as string) || null,
                criteria2: (args.criteria2 as string) || null,
                criteria3: (args.criteria3 as string) || null,
                criteria4: (args.criteria4 as string) || null,
                criteria5: (args.criteria5 as string) || null,
              });
              return JSON.stringify({ success: true, contact });
            }
            if (name === "edit_contact") {
              const contactId = args.contact_id as number;
              const existing = await getContactById(contactId);
              if (!existing) return JSON.stringify({ error: "Contact not found" });
              // Build a patch with only the fields that were explicitly provided
              const patch: Record<string, string | null> = {};
              const fields = ["name", "email", "company", "source", "timezone", "notes", "criteria1", "criteria2", "criteria3", "criteria4", "criteria5"] as const;
              for (const f of fields) {
                if (args[f] !== undefined) patch[f] = (args[f] as string) || null;
              }
              const updated = await updateContactById(contactId, patch);
              return JSON.stringify({ success: true, contact: updated });
            }
            if (name === "set_status") {
              await updateContactStatus(args.contact_id as number, args.status as string);
              return JSON.stringify({ success: true });
            }
            if (name === "list_tags") {
              const allTags = await listTags();
              return JSON.stringify(allTags);
            }
            if (name === "add_tag") {
              await bulkAddTagToContacts([args.contact_id as number], args.tag_id as number);
              return JSON.stringify({ success: true });
            }
            if (name === "remove_tag") {
              await removeTagFromContact(args.contact_id as number, args.tag_id as number);
              return JSON.stringify({ success: true });
            }
            if (name === "create_tag") {
              const tag = await createTag({ name: args.name as string, color: args.color as string });
              return JSON.stringify({ success: true, tag });
            }
            if (name === "search_contacts_by_tag") {
              const allTags = await listTags();
              let matchedTagId: number | null = null;
              if (args.tag_id !== undefined) {
                matchedTagId = args.tag_id as number;
              } else if (args.tag_name !== undefined) {
                const tagNameLower = (args.tag_name as string).toLowerCase();
                const found = allTags.find(t => t.name.toLowerCase().includes(tagNameLower));
                if (!found) return JSON.stringify({ error: `No tag found matching "${args.tag_name}". Available tags: ${allTags.map(t => t.name).join(", ")}` });
                matchedTagId = found.id;
              } else {
                return JSON.stringify({ error: "Provide tag_name or tag_id" });
              }
              const all = await listContacts({ tagIds: [matchedTagId] });
              // Return only essential fields to keep context small and avoid serialisation issues
              const slim = all.slice(0, 50).map(c => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, company: c.company, timezone: c.timezone, criteria1: c.criteria1, criteria2: c.criteria2, criteria3: c.criteria3, criteria4: c.criteria4, criteria5: c.criteria5, status: c.status, tags: c.tags.map(t => ({ id: t.id, name: t.name })) }));
              return JSON.stringify({ count: all.length, contacts: slim });
            }
            return JSON.stringify({ error: `Unknown tool: ${name}` });
          } catch (e: unknown) {
            return JSON.stringify({ error: String(e) });
          }
        }

        // ── Agentic loop (up to 8 tool calls) ────────────────────────────────
        type LLMMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] };
        const llmMessages: LLMMessage[] = [
          {
            role: "system",
            content: `You are a helpful contacts assistant for a sales dialler app. You can search, read, add, and edit contacts, manage their tags and statuses. Always search for a contact before editing them to confirm you have the right person. Be concise and confirm what you did after each action. Today's date: ${new Date().toLocaleDateString("en-AU")}.`,
          },
          ...input.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        let iterations = 0;
        while (iterations < 8) {
          iterations++;
          console.log(`[aiChat] iteration ${iterations}, messages so far: ${llmMessages.length}`);
          const response = await invokeLLM({ messages: llmMessages, tools, tool_choice: "auto" });
          if (!response?.choices?.length) {
            console.log(`[aiChat] empty choices — breaking`);
            break;
          }
          const msg = response.choices[0]?.message;
          if (!msg) {
            console.log(`[aiChat] no message — breaking`);
            break;
          }
          console.log(`[aiChat] finish_reason=${response.choices[0].finish_reason}, tool_calls=${JSON.stringify(msg.tool_calls?.map(tc => ({ name: tc.function.name, args: tc.function.arguments })) ?? null)}`);

          // If the model wants to call tools
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            llmMessages.push({ role: "assistant", content: (typeof msg.content === "string" ? msg.content : ""), tool_calls: msg.tool_calls });
            // Execute each tool call
            for (const tc of msg.tool_calls) {
              let toolArgs: Record<string, unknown> = {};
              try { toolArgs = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
              const result = await executeTool(tc.function.name, toolArgs);
              console.log(`[aiChat] tool=${tc.function.name} args=${tc.function.arguments} result=${result.slice(0, 200)}`);
              llmMessages.push({ role: "tool", content: result, tool_call_id: tc.id });
            }
            continue; // let the model respond to tool results
          }

          // Model produced a final text response
          const replyText = typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.map((c: { type: string; text?: string }) => c.type === "text" ? c.text : "").join("") : "Done.");
          console.log(`[aiChat] final reply: ${replyText?.slice(0, 200)}`);
          return { reply: replyText || "Done." };
        }

        console.log(`[aiChat] loop exhausted — returning fallback`);
        return { reply: "I've completed the requested actions." };
      }),

    // Legacy alias — kept so any deployed client that still calls contacts.addFromAI keeps working
    addFromAI: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })),
      }))
      .mutation(async () => {
        // Old procedure name — tell the user to refresh so the new aiChat procedure is used
        return { reply: "Your app is outdated. Please refresh the page (Ctrl+R / Cmd+R) and try again." };
      }),

    // Search all contacts (no tag-permission gate) — used for booking dialog
    search: protectedProcedure
      .input(z.object({ q: z.string().optional() }))
      .query(async ({ input }) => {
        const all = await listContacts({});
        if (!input.q) return all.slice(0, 50);
        const q = input.q.toLowerCase();
        return all.filter((c: { name?: string | null; phone?: string | null; email?: string | null }) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q) ||
          (c.email ?? "").toLowerCase().includes(q)
        ).slice(0, 50);
      }),
  }),

  // ─── Admin ────────────────────────────────────────────────────────────────
  admin: router({
    listUsers: adminProcedure
      .query(async () => {
        const allUsers = await listUsers();
        const permMap = await getAllUserTagPermissions();
        return allUsers.map(u => ({
          ...u,
          permittedTagIds: permMap.get(u.id) ?? [],
        }));
      }),
    setUserTagPermissions: adminProcedure
      .input(z.object({
        userId: z.number(),
        tagIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        await setUserTagPermissions(input.userId, input.tagIds);
        return { success: true };
      }),
    setUserRole: adminProcedure
      .input(z.object({
        userId: z.number(),
        role:   z.enum(['user', 'admin']),
      }))
      .mutation(async ({ input }) => {
        await setUserRole(input.userId, input.role);
        return { success: true };
      }),
    myPermittedTagIds: publicProcedure
      .query(async ({ ctx }) => {
        const user = (ctx as any).user;
        if (!user) return null;
        if (user.role === 'admin') return null;
        const tagIds = await getUserPermittedTagIds(user.id);
        return tagIds;
      }),
    createUser: adminProcedure
      .input(z.object({
        name:  z.string().min(1).max(100),
        email: z.string().email(),
        phone: z.string().min(6).max(32),
        role:  z.enum(['user', 'admin']).default('user'),
        origin: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const existing = await getUserByEmail(input.email);
        if (existing) throw new Error('A user with this email already exists');
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const user = await createCustomUser({
          name: input.name,
          email: input.email,
          phone: input.phone,
          inviteToken,
          role: input.role,
        });
        const origin = input.origin ?? 'https://oliviaai.app';
        const inviteUrl = `${origin}/invite?token=${inviteToken}`;

        // ── Step 1: Send immediate SMS + email invite ──────────────────────
        const smsBody = `Hi ${input.name}, you've been invited to OliviaAI by Henry Fortunatow to manage your leads, click here to get onboarded and access your leads now: ${inviteUrl}`;
        try {
          const normInvitePhone = normalisePhone(input.phone);
          await telnyxPost('/messages', {
            from: TELNYX_FROM_NUMBER,
            to: normInvitePhone,
            text: smsBody,
            messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
          });
          await insertSmsMessage({ phone: normInvitePhone, direction: 'outbound', body: smsBody, status: 'sent' });
        } catch (smsErr) {
          console.warn('[createUser] SMS send failed (non-fatal):', smsErr);
        }
        if (input.email) {
          try {
            const emailContent = buildInviteEmailHtml({
              recipientName: input.name,
              inviterName: 'Henry Fortunatow',
              inviteUrl,
            });
            await sendEmail({ to: input.email, subject: emailContent.subject, html: emailContent.html, text: emailContent.text, messageType: 'invite', fromName: 'Henry from Scalbl.io' });
          } catch (emailErr) {
            console.warn('[createUser] Email send failed (non-fatal):', emailErr);
          }
        }

        // ── Schedule drip follow-ups via heartbeat (every 30 min check) ───
        try {
          const sessionToken = parseCookie(ctx.req.headers.cookie ?? '')[COOKIE_NAME] ?? '';
          const job = await createHeartbeatJob({
            name: `invite-drip-${user.id}`,
            cron: '0 */30 * * * *',
            path: '/api/scheduled/inviteDrip',
            payload: { userId: user.id },
            description: `Invite drip for user ${user.id} (${input.email})`,
          }, sessionToken);
          await updateUserInviteStep(user.id, 1, job.taskUid);
        } catch (cronErr) {
          console.warn('[createUser] Heartbeat schedule failed (non-fatal):', cronErr);
          await updateUserInviteStep(user.id, 1);
        }

        return { success: true, userId: user.id, inviteUrl };
      }),
    deleteUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteUser(input.userId);
        return { success: true };
      }),
    resetUserPassword: adminProcedure
      .input(z.object({ userId: z.number(), newPassword: z.string().min(6) }))
      .mutation(async ({ input }) => {
        const hash = await bcrypt.hash(input.newPassword, 10);
        await updateUserPasswordHash(input.userId, hash);
        return { success: true };
      }),
  }),

  // ─── Email (2-way via Mailgun) ─────────────────────────────────────────────
  email: router({
    list: protectedProcedure
      .input(z.object({ email: z.string().email() }))
      .query(async ({ input }) => {
        return listEmailMessages(input.email);
      }),
    send: protectedProcedure
      .input(z.object({
        to:      z.string().email(),
        subject: z.string().min(1).max(500),
        body:    z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const externalId = await sendEmail({
          to:          input.to,
          subject:     input.subject,
          text:        input.body,
          messageType: 'manual',
          fromName:    "Henry from Scalbl.io",
        });
        return { success: true, externalId };
      }),
  }),

  // ─── SmartLists ───────────────────────────────────────────────────────────
  smartlists: router({
    list: publicProcedure
      .query(async ({ ctx }) => {
        const userId = (ctx as any).user?.id ?? 0;
        return listSmartlists(userId);
      }),
    create: publicProcedure
      .input(z.object({
        name:        z.string().min(1).max(100),
        filterRules: z.array(z.object({
          field:    z.string(),
          operator: z.string(),
          value:    z.string(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = (ctx as any).user?.id ?? 0;
        return createSmartlist({ userId, name: input.name, filterRules: input.filterRules });
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const userId = (ctx as any).user?.id ?? 0;
        await deleteSmartlist(input.id, userId);
        return { success: true };
      }),
    share: publicProcedure
      .input(z.object({
        id:         z.number(),
        isPublic:   z.boolean().optional(),
        sharedWith: z.array(z.number()).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = (ctx as any).user?.id ?? 0;
        await shareSmartlist(input.id, userId, {
          isPublic:   input.isPublic,
          sharedWith: input.sharedWith,
        });
        return { success: true };
      }),
  }),
  // ─── Automations ──────────────────────────────────────────────────────────
  automations: router({
    list: protectedProcedure.query(async () => {
      return listAutomations();
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const automation = await getAutomationById(input.id);
        if (!automation) throw new Error("Automation not found");
        const steps = await getAutomationSteps(input.id);
        return { ...automation, steps };
      }),
    create: protectedProcedure
      .input(z.object({
        name:               z.string().min(1).max(255),
        triggerType:        z.string().default("tag_added"),
        triggerTagId:       z.number().nullable().optional(),
        triggerCalendarId:  z.number().nullable().optional(),
        isActive:           z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        return createAutomation({
          name:               input.name,
          triggerType:        input.triggerType,
          triggerTagId:       input.triggerTagId ?? null,
          triggerCalendarId:  input.triggerCalendarId ?? null,
          isActive:           input.isActive,
        });
      }),
    update: protectedProcedure
      .input(z.object({
        id:                 z.number(),
        name:               z.string().min(1).max(255).optional(),
        triggerType:        z.string().optional(),
        triggerTagId:       z.number().nullable().optional(),
        triggerCalendarId:  z.number().nullable().optional(),
        isActive:           z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateAutomation(id, data);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteAutomation(input.id);
        return { success: true };
      }),
    saveSteps: protectedProcedure
      .input(z.object({
        automationId: z.number(),
        steps: z.array(z.object({
          stepType:     z.enum(["wait", "sms", "email", "imessage"]),
          waitValue:    z.number().nullable().optional(),
          waitUnit:     z.enum(["minutes", "hours", "days"]).nullable().optional(),
          waitMode:     z.enum(["delay", "before_event"]).nullable().optional(),
          eventType:    z.string().nullable().optional(),
          smsBody:      z.string().nullable().optional(),
          emailSubject: z.string().nullable().optional(),
          emailBody:    z.string().nullable().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const steps = await replaceAutomationSteps(input.automationId, input.steps.map((s, i) => ({
          stepOrder:    i,
          stepType:     s.stepType,
          waitValue:    s.waitValue ?? null,
          waitUnit:     s.waitUnit ?? null,
          waitMode:     s.waitMode ?? "delay",
          eventType:    s.eventType ?? null,
          smsBody:      s.smsBody ?? null,
          emailSubject: s.emailSubject ?? null,
          emailBody:    s.emailBody ?? null,
        })));
        return steps;
      }),
    enrollments: protectedProcedure
      .input(z.object({ automationId: z.number() }))
      .query(async ({ input }) => {
        return listEnrollmentsForAutomation(input.automationId);
      }),
    buildFromPrompt: protectedProcedure
      .input(z.object({ prompt: z.string().min(1).max(2000) }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import("./_core/llm");
        const systemPrompt = `You are an automation builder assistant for a sales CRM.
The user will describe an automation they want. You must return a JSON object with this exact shape:
{
  "name": string,          // short descriptive name for the automation
  "triggerType": "tag_added" | "appointment_booked",
  "steps": Array<Step>
}

Where each Step is one of:
- Wait step:     { "stepType": "wait", "waitValue": number, "waitUnit": "minutes"|"hours"|"days", "waitMode": "delay"|"before_event", "eventType": null, "smsBody": null, "emailSubject": null, "emailBody": null }
- SMS step:      { "stepType": "sms", "waitValue": null, "waitUnit": null, "waitMode": null, "eventType": null, "smsBody": string, "emailSubject": null, "emailBody": null }
- iMessage step: { "stepType": "imessage", "waitValue": null, "waitUnit": null, "waitMode": null, "eventType": null, "smsBody": string, "emailSubject": null, "emailBody": null }
- Email step:    { "stepType": "email", "waitValue": null, "waitUnit": null, "waitMode": null, "eventType": null, "smsBody": null, "emailSubject": string, "emailBody": string }

Rules:
- Use waitMode "before_event" only for appointment_booked trigger, and only when the user wants to send something before the appointment time.
- Use waitMode "delay" for all other waits.
- Available placeholders in message bodies: {{first_name}}, {{last_name}}, {{full_name}}, {{phone}}, {{email}}, {{company}}, {{appointment_title}}, {{appointment_date}}, {{appointment_time}}, {{appointment_timezone}}
- Always start with a Wait step before the first message unless the user says to send immediately.
- Keep message bodies concise and professional.
- Return ONLY valid JSON, no markdown, no explanation.`;

        const result = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "automation_blueprint",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  triggerType: { type: "string", enum: ["tag_added", "appointment_booked"] },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        stepType:     { type: "string", enum: ["wait", "sms", "email", "imessage"] },
                        waitValue:    { type: ["number", "null"] },
                        waitUnit:     { type: ["string", "null"] },
                        waitMode:     { type: ["string", "null"] },
                        eventType:    { type: ["string", "null"] },
                        smsBody:      { type: ["string", "null"] },
                        emailSubject: { type: ["string", "null"] },
                        emailBody:    { type: ["string", "null"] },
                      },
                      required: ["stepType", "waitValue", "waitUnit", "waitMode", "eventType", "smsBody", "emailSubject", "emailBody"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "triggerType", "steps"],
                additionalProperties: false,
              },
            },
          },
        });

        const rawContent = result.choices?.[0]?.message?.content;
        const content = typeof rawContent === "string" ? rawContent : null;
        if (!content) throw new Error("AI returned no content");
        try {
          const blueprint = JSON.parse(content);
          return blueprint as { name: string; triggerType: string; steps: Array<Record<string, unknown>> };
        } catch {
          throw new Error("AI returned invalid JSON");
        }
      }),

    /**
     * Register (or refresh) the automationRun heartbeat cron job.
     * Runs every minute and processes due automation enrollments.
     * Safe to call multiple times — idempotent via name-based upsert.
     */
    setupHeartbeat: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { updateHeartbeatJob } = await import("./_core/heartbeat");
        // Extract the raw app_session_id cookie value for Forge authentication
        const { parse: parseCookieLocal } = await import("cookie");
        const cookies = parseCookieLocal(ctx.req.headers.cookie ?? "");
        const sessionToken = cookies["app_session_id"] ?? "";
        const existingUid = await getAppSetting("automationHeartbeatTaskUid");
        if (existingUid) {
          // Heartbeat already registered — ensure it's enabled
          try {
            await updateHeartbeatJob(existingUid, { enable: true }, sessionToken);
            return { taskUid: existingUid, created: false };
          } catch {
            // UID stale — fall through to create a new one
          }
        }
        const job = await createHeartbeatJob({
          name: "automationRun",
          cron: "0 * * * * *",   // every minute
          path: "/api/scheduled/automationRun",
          description: "Process due automation enrollment steps",
        }, sessionToken);
        await setAppSetting("automationHeartbeatTaskUid", job.taskUid);
        return { taskUid: job.taskUid, created: true };
      }),

    executionLogs: protectedProcedure
      .input(z.object({
        automationId: z.number().optional(),
        contactId:    z.number().optional(),
        stepType:     z.string().optional(),
        status:       z.string().optional(),
        fromTs:       z.number().optional(),
        toTs:         z.number().optional(),
        limit:        z.number().min(1).max(100).default(50),
        offset:       z.number().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const [logs, total] = await Promise.all([
          getExecutionLogs(input),
          countExecutionLogs(input),
        ]);
        return { logs, total };
      }),

    /** Manually trigger the automation processor right now (useful for testing). */
    runNow: protectedProcedure
      .mutation(async ({ ctx }) => {
        const origin = `http://localhost:${process.env.PORT ?? 3000}`;
        const res = await fetch(`${origin}/api/scheduled/automationRun`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Pass the session cookie so the endpoint can authenticate
            Cookie: ctx.req.headers.cookie ?? "",
            "x-internal-cron": "1",
          },
        });
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        return { ok: res.ok, status: res.status, body };
      }),
  }),

  // ─── Conversations AI ──────────────────────────────────────────────────────
  conversations: router({
    /** Generate an AI-drafted SMS/iMessage or email body for a contact. */
    generateMessage: protectedProcedure
      .input(z.object({
        prompt:      z.string().min(1).max(2000),
        channel:     z.enum(["sms", "email"]),
        contactName: z.string().optional(),
        contactPhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import("./_core/llm");
        const channelLabel = input.channel === "email" ? "email" : "SMS/iMessage";
        const systemPrompt = `You are a professional sales assistant helping draft outbound ${channelLabel} messages.
Write a concise, natural, and professional message based on the user's instruction.
If the contact name is provided, personalise the message appropriately.
Return ONLY the message body text — no subject line, no labels, no markdown, no explanation.
For SMS keep it under 160 characters unless the user explicitly asks for longer.`;
        const userPrompt = input.contactName
          ? `Contact: ${input.contactName}${input.contactPhone ? ` (${input.contactPhone})` : ""}\n\n${input.prompt}`
          : input.prompt;
        const result = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
        });
        const text = result.choices?.[0]?.message?.content;
        if (!text || typeof text !== "string") throw new Error("AI returned no content");
        return { text: text.trim() };
      }),
  }),

  // ─── Calendars ──────────────────────────────────────────────────────────────
  calendars: router({
    list: protectedProcedure.query(async () => {
      return listCalendars();
    }),
    create: protectedProcedure
      .input(z.object({
        name:  z.string().min(1).max(255),
        type:  z.enum(["user", "custom"]).default("custom"),
        color: z.string().default("#6366f1"),
      }))
      .mutation(async ({ input, ctx }) => {
        return createCalendar({
          name:    input.name,
          type:    input.type,
          ownerId: ctx.user.id,
          color:   input.color,
        });
      }),
    update: protectedProcedure
      .input(z.object({
        id:    z.number(),
        name:  z.string().min(1).max(255).optional(),
        color: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCalendar(id, data);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteCalendar(input.id);
        return { success: true };
      }),
  }),

  // ─── Appointments ────────────────────────────────────────────────────────────
  appointments: router({
    list: protectedProcedure
      .input(z.object({
        calendarIds: z.array(z.number()).optional(),
        from:        z.number().optional(),
        to:          z.number().optional(),
        status:      z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return listAppointments(input ?? {});
      }),
    create: protectedProcedure
      .input(z.object({
        calendarId: z.number(),
        contactId:  z.number().optional(),
        title:      z.string().min(1).max(255),
        startAt:    z.number(),
        endAt:      z.number(),
        notes:      z.string().optional(),
        status:     z.string().default("scheduled"),
        timezone:   z.string().default("UTC"),
      }))
      .mutation(async ({ input }) => {
        const appt = await createAppointment({
          calendarId: input.calendarId,
          contactId:  input.contactId ?? null,
          title:      input.title,
          startAt:    input.startAt,
          endAt:      input.endAt,
          notes:      input.notes ?? null,
          status:     input.status,
          timezone:   input.timezone,
        });
        // Fire appointment_booked automations for the linked contact
        if (input.contactId) {
          try {
            const apptAutomations = await getAutomationsForAppointmentBooked(input.calendarId);
            for (const auto of apptAutomations) {
              await enrollContact(auto.id, input.contactId, Date.now(), input.startAt);
            }
          } catch (err) {
            console.warn('[appointments.create] automation enroll failed (non-fatal):', err);
          }
        }
        return appt;
      }),
    update: protectedProcedure
      .input(z.object({
        id:         z.number(),
        calendarId: z.number().optional(),
        contactId:  z.number().nullable().optional(),
        title:      z.string().optional(),
        startAt:    z.number().optional(),
        endAt:      z.number().optional(),
        notes:      z.string().optional(),
        status:     z.string().optional(),
        timezone:   z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateAppointment(id, data);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteAppointment(input.id);
        return { success: true };
      }),
  }),

  // ─── What's New (product updates) ──────────────────────────────────────────
  whatsNew: router({
    // All updates, newest first, each flagged with whether the current user
    // has dismissed it. Drives both the auto-popup (filter !dismissed) and the
    // manual "view all" list.
    list: protectedProcedure.query(async ({ ctx }) => {
      const [all, dismissedIds] = await Promise.all([
        listUpdates(),
        getDismissedUpdateIds(ctx.user.id),
      ]);
      const dismissed = new Set(dismissedIds);
      return all.map(u => ({ ...u, dismissed: dismissed.has(u.id) }));
    }),
    dismiss: protectedProcedure
      .input(z.object({ updateIds: z.array(z.number()).min(1) }))
      .mutation(async ({ input, ctx }) => {
        await dismissUpdatesForUser(ctx.user.id, input.updateIds);
        return { success: true };
      }),
    create: adminProcedure
      .input(z.object({ title: z.string().min(1).max(255), body: z.string().min(1) }))
      .mutation(async ({ input }) => {
        return createUpdate(input);
      }),
    update: adminProcedure
      .input(z.object({ id: z.number(), title: z.string().min(1).max(255), body: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await updateUpdate(input.id, { title: input.title, body: input.body });
        return { success: true };
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteUpdate(input.id);
        return { success: true };
      }),
  }),

});

export type AppRouter = typeof appRouter;
