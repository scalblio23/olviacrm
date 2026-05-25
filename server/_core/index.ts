import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { insertSmsMessage, getUserById, getUsersPendingDrip, updateUserInviteStep, getDueEnrollments, getAutomationSteps, getContactById, updateEnrollment, getAppointmentByEventTimestamp, normalisePhone, insertExecutionLog } from "../db";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { sendEmail, buildFollowUp1Html, buildReminderHtml } from "../mailgun";

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY ?? "";
const TELNYX_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER ?? "+61485825732";

async function telnyxSms(to: string, text: string) {
  const normTo = normalisePhone(to);
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TELNYX_API_KEY}`,
    },
    body: JSON.stringify({
      from: TELNYX_FROM_NUMBER,
      to: normTo,
      text,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Telnyx SMS failed: ${JSON.stringify(err)}`);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // ─── Telnyx Webhook ───────────────────────────────────────────────────────
  app.post("/api/telnyx/webhook", (req, res) => {
    res.status(200).json({ received: true });
    const raw = req.body as Record<string, unknown>;
    console.log("[Telnyx Webhook] RAW:", JSON.stringify(raw).slice(0, 600));
    const envelope   = (raw?.data ?? raw) as Record<string, unknown>;
    const eventType  = (envelope?.event_type ?? "unknown") as string;
    const payload    = (envelope?.payload ?? {}) as Record<string, unknown>;
    console.log(`[Telnyx Webhook] event_type=${eventType}`);
    if (eventType === "message.received") {
      const fromRaw = payload?.from;
      const from = typeof fromRaw === "string"
        ? fromRaw
        : (fromRaw as Record<string, unknown>)?.phone_number as string | undefined;
      const text  = (payload?.text ?? payload?.body) as string | undefined;
      const msgId = (payload?.id ?? payload?.message_id) as string | undefined;
      console.log(`[Telnyx Webhook] SMS from=${from} text=${String(text).slice(0, 80)}`);
      if (from && text) {
        insertSmsMessage({
          phone:      from,
          direction:  "inbound",
          body:       text,
          status:     "received",
          externalId: msgId ?? null,
        }).catch((err: unknown) => {
          console.error("[Telnyx Webhook] Failed to persist inbound SMS:", err);
        });
      } else {
        console.warn("[Telnyx Webhook] message.received but missing from/text — payload:", JSON.stringify(payload).slice(0, 400));
      }
    }
  });

  // ─── Blooio Webhook (inbound iMessages) ──────────────────────────────────
  app.post("/api/blooio/webhook", (req, res) => {
    res.status(200).json({ received: true });
    const raw = req.body as Record<string, unknown>;
    console.log("[Blooio Webhook] RAW:", JSON.stringify(raw).slice(0, 600));
    const event = raw?.event as string | undefined;
    const data  = (raw?.data ?? raw) as Record<string, unknown>;
    const from  = (data?.from ?? data?.sender ?? data?.phone_number ?? raw?.from) as string | undefined;
    const text  = (data?.text ?? data?.body ?? data?.content ?? raw?.text)        as string | undefined;
    const msgId = (data?.id   ?? data?.message_id ?? raw?.id)                     as string | undefined;
    console.log(`[Blooio Webhook] event=${event} from=${from} text=${String(text).slice(0, 80)}`);
    if (from && text) {
      insertSmsMessage({
        phone:      from,
        direction:  "inbound",
        body:       text,
        status:     "received",
        externalId: msgId ?? null,
        channel:    "imessage",
      }).catch((err: unknown) => {
        console.error("[Blooio Webhook] Failed to persist inbound iMessage:", err);
      });
    } else {
      console.warn("[Blooio Webhook] Missing from/text — payload:", JSON.stringify(raw).slice(0, 400));
    }
  });

  // ─── Invite Drip Heartbeat ────────────────────────────────────────────────
  // Triggered every 30 minutes per user. Sends follow-up messages at:
  //   step 1 → 2: 1 hour after creation  (2 × 30-min ticks)
  //   step 2 → 3: 24 hours after step 2  (48 × 30-min ticks)
  //   step 3 → 4: 48 hours after step 3  (96 × 30-min ticks)
  // The heartbeat fires every 30 min; we look at updatedAt to decide if enough
  // time has elapsed before sending the next message.
  app.post("/api/scheduled/inviteDrip", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: "cron-only" });
      }

      // Find the user whose cron task uid matches
      const pendingUsers = await getUsersPendingDrip();
      const targetUser = pendingUsers.find(u => u.inviteCronTaskUid === user.taskUid);
      if (!targetUser) {
        return res.json({ ok: true, skipped: "orphan or already completed" });
      }

      const now = Date.now();
      const updatedAt = targetUser.updatedAt.getTime();
      const elapsedMs = now - updatedAt;
      const step = targetUser.inviteSequenceStep;
      const inviteUrl = `https://oliviaai.app/invite?token=${targetUser.inviteToken ?? ''}`;
      const name = targetUser.name ?? 'there';
      const email = targetUser.email ?? '';

      // Thresholds: step 1→2 after 1hr, step 2→3 after 24hr, step 3→4 after 48hr
      const thresholds: Record<number, number> = {
        1: 60 * 60 * 1000,           // 1 hour
        2: 24 * 60 * 60 * 1000,      // 24 hours
        3: 48 * 60 * 60 * 1000,      // 48 hours
      };

      const threshold = thresholds[step];
      if (!threshold || elapsedMs < threshold) {
        return res.json({ ok: true, skipped: `not yet time (step=${step}, elapsed=${Math.round(elapsedMs/60000)}min)` });
      }

      // Build message content
      let smsText: string;
      let emailContent: { subject: string; html: string; text: string };

      if (step === 1) {
        smsText = `${name} don't forget to join OliviaAI to manage your leads with Scalbl.io: ${inviteUrl}`;
        emailContent = buildFollowUp1Html({ recipientName: name, inviteUrl });
      } else if (step === 2) {
        smsText = `${name} don't forget to join OliviaAI to manage your leads with Scalbl.io: ${inviteUrl}`;
        emailContent = buildReminderHtml({ recipientName: name, inviteUrl, dayNumber: 1 });
      } else {
        // step === 3
        smsText = `${name} don't forget to join OliviaAI to manage your leads with Scalbl.io: ${inviteUrl}`;
        emailContent = buildReminderHtml({ recipientName: name, inviteUrl, dayNumber: 2 });
      }

      // Send SMS
      if (targetUser.phone) {
        try {
          await telnyxSms(targetUser.phone, smsText);
          await insertSmsMessage({ phone: targetUser.phone, direction: 'outbound', body: smsText, status: 'sent' });
        } catch (smsErr) {
          console.warn('[inviteDrip] SMS send failed:', smsErr);
        }
      }

      // Send email
      if (email) {
        try {
          await sendEmail({ to: email, subject: emailContent.subject, html: emailContent.html, text: emailContent.text, messageType: 'invite', fromName: 'Henry from Scalbl.io' });
        } catch (emailErr) {
          console.warn('[inviteDrip] Email send failed:', emailErr);
        }
      }

      // Advance step (step 4 = complete)
      const nextStep = step + 1;
      await updateUserInviteStep(targetUser.id, nextStep);

      console.log(`[inviteDrip] User ${targetUser.id} advanced from step ${step} to ${nextStep}`);
      return res.json({ ok: true, userId: targetUser.id, step, nextStep });
    } catch (err: unknown) {
      console.error("[inviteDrip] Error:", err);
      return res.status(500).json({
        error: String(err),
        context: { url: req.url, taskUid: "unknown" },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Automation Enrollment Processor ─────────────────────────────────────────
  app.post("/api/scheduled/automationRun", async (req, res) => {
    try {
      // Allow internal server-side calls (e.g. from the runNow tRPC procedure)
      const isInternalCall = req.headers["x-internal-cron"] === "1";
      if (!isInternalCall) {
        const user = await sdk.authenticateRequest(req);
        if (!user.isCron) {
          return res.status(403).json({ error: "Forbidden: cron only" });
        }
      }
      const enrollments = await getDueEnrollments();
      let processed = 0;
      for (const enrollment of enrollments) {
        try {
          const steps = await getAutomationSteps(enrollment.automationId);
          if (steps.length === 0) {
            await updateEnrollment(enrollment.id, { status: "completed" });
            continue;
          }

          const contact = await getContactById(enrollment.contactId);
          if (!contact) {
            await updateEnrollment(enrollment.id, { status: "cancelled" });
            continue;
          }

          // Variable substitution helper
          const nameParts = (contact.name ?? "").split(" ");
          const vars: Record<string, string> = {
            first_name:  nameParts[0] ?? "",
            last_name:   nameParts.slice(1).join(" ") ?? "",
            full_name:   contact.name ?? "",
            phone:       contact.phone ?? "",
            email:       contact.email ?? "",
            company:     (contact as Record<string, unknown>).company as string ?? "",
          };
          // Contact timezone — prefer contact's own timezone, fall back to appointment timezone
          const contactTimezone = (contact as Record<string, unknown>).timezone as string | null | undefined;

          // Resolve appointment placeholders if this enrollment has an eventTimestamp
          if (enrollment.eventTimestamp) {
            const appt = await getAppointmentByEventTimestamp(enrollment.eventTimestamp, enrollment.contactId);
            if (appt) {
              // Priority: contact timezone > appointment timezone > UTC
              const tz = contactTimezone || appt.timezone || "UTC";
              const apptDate = new Date(appt.startAt);
              vars.appointment_title    = appt.title ?? "";
              vars.appointment_date     = apptDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
              vars.appointment_time     = apptDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
              vars.appointment_timezone = tz;
            }
          } else if (contactTimezone) {
            // No appointment, but contact has a timezone — expose it for use in templates
            vars.appointment_timezone = contactTimezone;
          }
          const interpolate = (template: string): string =>
            template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");

          // Helper: compute nextRunAt for a WAIT step
          const computeWaitNextRunAt = (waitStep: typeof steps[0]): number => {
            if (!waitStep.waitValue || !waitStep.waitUnit) return Date.now();
            const val  = waitStep.waitValue;
            const unit = waitStep.waitUnit;
            let offsetMs = 0;
            if (unit === "minutes") offsetMs = val * 60_000;
            else if (unit === "hours") offsetMs = val * 3_600_000;
            else if (unit === "days")  offsetMs = val * 86_400_000;
            if (waitStep.waitMode === "before_event") {
              const eventTs = enrollment.eventTimestamp;
              if (eventTs) return eventTs - offsetMs;
              return Date.now() + offsetMs;
            }
            return Date.now() + offsetMs;
          };

          // ── Process steps in a loop, running consecutive action steps together ──
          // Stop when we hit a wait step (schedule for later) or run out of steps.
          let currentIdx = enrollment.currentStep ?? 0;
          let didWork = false;

          while (currentIdx < steps.length) {
            const step = steps[currentIdx];

            if (step.stepType === "wait") {
              const nextIdx = currentIdx + 1;
              const scheduledAt = computeWaitNextRunAt(step);
              const now = Date.now();

              // If this is a before_event wait and the trigger time has already passed,
              // skip this wait step AND ALL following action steps until the next wait step.
              if (step.waitMode === "before_event" && scheduledAt <= now) {
                console.log(`[automation] Skipping expired before_event wait (step ${currentIdx}) — scheduled ${new Date(scheduledAt).toISOString()} is in the past`);
                await insertExecutionLog({ automationId: enrollment.automationId, enrollmentId: enrollment.id, contactId: enrollment.contactId, stepIndex: currentIdx, stepType: "wait", status: "skipped", detail: `Expired: ${step.waitValue}${step.waitUnit} before event`, executedAt: Date.now() });
                // Skip all consecutive non-wait action steps that follow
                let skipIdx = nextIdx;
                while (skipIdx < steps.length && steps[skipIdx].stepType !== "wait") {
                  await insertExecutionLog({ automationId: enrollment.automationId, enrollmentId: enrollment.id, contactId: enrollment.contactId, stepIndex: skipIdx, stepType: steps[skipIdx].stepType, status: "skipped", detail: "Skipped — wait window already passed", executedAt: Date.now() });
                  skipIdx++;
                }
                currentIdx = skipIdx; // resume at the next wait step (or end)
                didWork = true;
                continue; // keep looping — there may be more wait/action pairs ahead
              }

              // Not expired — schedule the next action step for later
              await insertExecutionLog({ automationId: enrollment.automationId, enrollmentId: enrollment.id, contactId: enrollment.contactId, stepIndex: currentIdx, stepType: "wait", status: "waiting", detail: step.waitMode === "before_event" ? `${step.waitValue}${step.waitUnit} before event — fires ${new Date(scheduledAt).toISOString()}` : `Delay ${step.waitValue}${step.waitUnit}`, executedAt: Date.now() });
              if (nextIdx >= steps.length) {
                await updateEnrollment(enrollment.id, { status: "completed" });
              } else {
                await updateEnrollment(enrollment.id, {
                  currentStep: nextIdx,
                  nextRunAt: scheduledAt,
                });
              }
              didWork = true;
              break; // stop processing this enrollment until the scheduled time

            } else if (step.stepType === "sms") {
              const body = interpolate(step.smsBody ?? "");
              let smsStatus = "executed";
              if (body && contact.phone) {
                try {
                  await telnyxSms(contact.phone, body);
                  await insertSmsMessage({ phone: contact.phone, direction: "outbound", body, channel: "sms", status: "sent" });
                } catch (e) { smsStatus = "failed"; }
              } else { smsStatus = "skipped"; }
              await insertExecutionLog({ automationId: enrollment.automationId, enrollmentId: enrollment.id, contactId: enrollment.contactId, stepIndex: currentIdx, stepType: "sms", status: smsStatus, detail: body ? body.slice(0, 120) : "(no body)", executedAt: Date.now() });
              currentIdx++;
              didWork = true;

            } else if (step.stepType === "email") {
              const subject = interpolate(step.emailSubject ?? "");
              const body    = interpolate(step.emailBody ?? "");
              let emailStatus = "executed";
              if (subject && body && contact.email) {
                try {
                  await sendEmail({
                    to: contact.email,
                    subject,
                    text: body,
                    html: `<div style="font-family:sans-serif;white-space:pre-wrap">${body}</div>`,
                    messageType: "automation",
                    fromName: "Henry from Scalbl.io",
                  });
                } catch (e) { emailStatus = "failed"; }
              } else { emailStatus = "skipped"; }
              await insertExecutionLog({ automationId: enrollment.automationId, enrollmentId: enrollment.id, contactId: enrollment.contactId, stepIndex: currentIdx, stepType: "email", status: emailStatus, detail: subject || "(no subject)", executedAt: Date.now() });
              currentIdx++;
              didWork = true;

            } else if (step.stepType === "imessage") {
              const body = interpolate(step.smsBody ?? "");
              let imsgStatus = "executed";
              if (body && contact.phone) {
                const BLOOIO_API_KEY = process.env.BLOOIO_API_KEY ?? "";
                if (BLOOIO_API_KEY) {
                  const encoded = encodeURIComponent(contact.phone);
                  const blooRes = await fetch(`https://backend.blooio.com/v2/api/chats/${encoded}/messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BLOOIO_API_KEY}` },
                    body: JSON.stringify({ text: body }),
                  });
                  if (!blooRes.ok) {
                    const err = await blooRes.json().catch(() => ({}));
                    console.error(`[automationRun] Blooio iMessage failed:`, err);
                    imsgStatus = "failed";
                  } else {
                    await insertSmsMessage({ phone: contact.phone, direction: "outbound", body, channel: "imessage", status: "sent" });
                  }
                } else {
                  console.warn("[automationRun] BLOOIO_API_KEY not set, skipping iMessage step");
                  imsgStatus = "skipped";
                }
              } else { imsgStatus = "skipped"; }
              await insertExecutionLog({ automationId: enrollment.automationId, enrollmentId: enrollment.id, contactId: enrollment.contactId, stepIndex: currentIdx, stepType: "imessage", status: imsgStatus, detail: body ? body.slice(0, 120) : "(no body)", executedAt: Date.now() });
              currentIdx++;
              didWork = true;

            } else {
              // Unknown step type — skip
              currentIdx++;
            }
          }

          // If we exhausted all steps without hitting a wait, mark complete
          if (currentIdx >= steps.length && didWork) {
            await updateEnrollment(enrollment.id, { status: "completed" });
          }

          processed++;
        } catch (stepErr) {
          console.error(`[automationRun] Error processing enrollment ${enrollment.id}:`, stepErr);
        }
      }
      return res.json({ ok: true, processed, total: enrollments.length });
    } catch (err: unknown) {
      console.error("[automationRun] Error:", err);
      return res.status(500).json({ error: String(err) });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
