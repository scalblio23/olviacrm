import { eq, asc, desc, inArray, and, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, User, leads, leadSessions, InsertLead, Lead, callHistory, InsertCallHistory, CallHistoryRecord, smsMessages, InsertSmsMessage, SmsMessage, contacts, InsertContact, Contact, tags, InsertTag, Tag, contactTags, smartlists, Smartlist, InsertSmartlist, userTagPermissions, emailMessages, EmailMessage, automations, Automation, InsertAutomation, automationSteps, AutomationStep, InsertAutomationStep, automationEnrollments, AutomationEnrollment, calendars, Calendar, InsertCalendar, appointments, Appointment, InsertAppointment, appSettings, automationExecutionLogs, AutomationExecutionLog, InsertAutomationExecutionLog, updates, Update, updateDismissals } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createCustomUser(params: {
  name: string;
  email: string;
  phone?: string;
  inviteToken?: string;
  role: 'user' | 'admin';
}): Promise<User> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  // openId for custom users is 'custom_<email>' to keep the unique constraint happy
  const openId = `custom_${params.email}`;
  await db.insert(users).values({
    openId,
    name: params.name,
    email: params.email,
    phone: params.phone ?? null,
    inviteToken: params.inviteToken ?? null,
    role: params.role,
    loginMethod: 'password',
    lastSignedIn: new Date(),
  });
  const created = await getUserByEmail(params.email);
  if (!created) throw new Error('Failed to create user');
  return created;
}

export async function getUserByInviteToken(token: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.inviteToken, token)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function clearInviteToken(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ inviteToken: null }).where(eq(users.id, userId));
}

export async function updateUserPasswordHash(userId: number, passwordHash: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function deleteUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  // Remove tag permissions first, then the user
  await db.delete(userTagPermissions).where(eq(userTagPermissions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

// ─── Lead Session helpers ─────────────────────────────────────────────────────

export async function createLeadSession(sessionId: string, fileName: string, tagId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(leadSessions).values({ sessionId, fileName, tagId: tagId ?? null });
  return sessionId;
}

export async function getLatestLeadSession() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(leadSessions).orderBy(desc(leadSessions.id)).limit(1);
  return rows[0] ?? null;
}

export async function insertLeads(rows: InsertLead[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (rows.length === 0) return;
  // Insert in batches of 50 to stay within TiDB packet limits for large uploads
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(leads).values(rows.slice(i, i + BATCH));
  }
}

export async function getLeadsBySession(sessionId: string): Promise<Lead[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(leads).where(eq(leads.sessionId, sessionId)).orderBy(asc(leads.id));
}

export async function getLeadById(id: number): Promise<Lead | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return result[0];
}

export async function updateLeadDisposition(
  id: number,
  disposition: Lead["disposition"]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leads).set({ disposition }).where(eq(leads.id, id));
}

export async function updateLeadNotes(id: number, notes: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leads).set({ notes }).where(eq(leads.id, id));
}

// ─── Call History helpers ─────────────────────────────────────────────────────

export async function insertCallHistory(record: InsertCallHistory): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(callHistory).values(record);
}

export async function getCallHistoryByPhone(phone: string): Promise<CallHistoryRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(callHistory)
    .where(eq(callHistory.phone, phone))
    .orderBy(desc(callHistory.startedAt))
    .limit(100);
}

export async function getCallHistoryByLead(leadId: number): Promise<CallHistoryRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(callHistory)
    .where(eq(callHistory.leadId, leadId))
    .orderBy(desc(callHistory.startedAt))
    .limit(50);
}

export async function getAllCallHistory(limit = 200): Promise<CallHistoryRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(callHistory)
    .orderBy(desc(callHistory.startedAt))
    .limit(limit);
}

// ─── SMS Message helpers ──────────────────────────────────────────────────────

export async function insertSmsMessage(record: InsertSmsMessage): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(smsMessages).values(record);
}

export async function getSmsThread(phone: string, limit = 200): Promise<SmsMessage[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Normalise the phone and also query the raw form so threads show regardless of storage format
  const normalised = normalisePhone(phone);
  const phonesToMatch = Array.from(new Set([phone, normalised]));
  return db
    .select()
    .from(smsMessages)
    .where(inArray(smsMessages.phone, phonesToMatch))
    .orderBy(desc(smsMessages.createdAt))
    .limit(limit);
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(tags).orderBy(asc(tags.name));
}

export async function createTag(data: InsertTag): Promise<Tag> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(tags).values(data);
  const rows = await db.select().from(tags).where(eq(tags.name, data.name)).limit(1);
  return rows[0];
}

export async function deleteTag(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Remove junction rows first
  await db.delete(contactTags).where(eq(contactTags.tagId, id));
  await db.delete(tags).where(eq(tags.id, id));
}

export async function getTagsForContact(contactId: number): Promise<Tag[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const junctions = await db.select().from(contactTags).where(eq(contactTags.contactId, contactId));
  if (junctions.length === 0) return [];
  const tagIds = junctions.map(j => j.tagId);
  return db.select().from(tags).where(inArray(tags.id, tagIds));
}

export async function removeTagFromContact(contactId: number, tagId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(contactTags).where(
    and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId))
  );
}

export async function setContactTags(contactId: number, tagIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing then re-insert
  await db.delete(contactTags).where(eq(contactTags.contactId, contactId));
  if (tagIds.length > 0) {
    await db.insert(contactTags).values(tagIds.map(tagId => ({ contactId, tagId })));
  }
}

// ─── Contact helpers ──────────────────────────────────────────────────────────

export async function upsertContact(record: InsertContact): Promise<Contact> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Always store phone in E.164 format so it matches normalised SMS/call records
  const normalisedRecord = { ...record, phone: normalisePhone(record.phone) };
  await db
    .insert(contacts)
    .values(normalisedRecord)
    .onDuplicateKeyUpdate({
      set: {
        // Only overwrite name if explicitly provided (don't clear existing name if not in CSV)
        ...(record.name !== undefined ? { name: record.name } : {}),
        email:     record.email ?? null,
        company:   record.company ?? null,
        notes:     record.notes ?? null,
        source:    record.source ?? null,
        criteria1: record.criteria1 ?? null,
        criteria2: record.criteria2 ?? null,
        criteria3: record.criteria3 ?? null,
        criteria4: record.criteria4 ?? null,
        criteria5: record.criteria5 ?? null,
        // Sales-pipeline fields: only overwrite when explicitly provided, so a
        // lead-list CSV re-import never wipes a closer's manually-entered data.
        ...(record.closer !== undefined ? { closer: record.closer } : {}),
        ...(record.priceQuoted !== undefined ? { priceQuoted: record.priceQuoted } : {}),
        ...(record.callRecordingUrl !== undefined ? { callRecordingUrl: record.callRecordingUrl } : {}),
        ...(record.objections !== undefined ? { objections: record.objections } : {}),
        // Only overwrite status if explicitly provided (null means 'not set', undefined means 'keep existing')
        ...(record.status !== undefined ? { status: record.status } : {}),
        ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
        ...(record.dealResult !== undefined ? { dealResult: record.dealResult } : {}),
        ...(record.timezone !== undefined ? { timezone: record.timezone } : {}),
        // Only overwrite createdAt if explicitly provided (e.g. from CSV import)
        ...(record.createdAt !== undefined ? { createdAt: record.createdAt } : {}),
      },
    });
  const rows = await db.select().from(contacts).where(eq(contacts.phone, normalisedRecord.phone)).limit(1);
  return rows[0];
}

export async function updateContactStatus(id: number, status: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(contacts).set({ status }).where(eq(contacts.id, id));
}

export async function updateContactById(id: number, patch: Partial<Omit<InsertContact, 'id' | 'phone' | 'createdAt' | 'updatedAt'>>): Promise<Contact | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (Object.keys(patch).length > 0) {
    await db.update(contacts).set(patch).where(eq(contacts.id, id));
  }
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateContactOutcome(id: number, outcome: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(contacts).set({ outcome }).where(eq(contacts.id, id));
}

export async function updateContactDealResult(id: number, dealResult: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(contacts).set({ dealResult }).where(eq(contacts.id, id));
}

export async function bulkUpdateContactStatus(ids: number[], status: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (ids.length === 0) return;
  await db.update(contacts).set({ status }).where(inArray(contacts.id, ids));
}

export type ContactWithTags = Contact & { tags: Tag[] };

export async function listContacts(opts?: {
  dateFrom?: Date;
  dateTo?: Date;
  tagIds?: number[];
}): Promise<ContactWithTags[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // If tag filter is active, first get contact IDs that have those tags
  let tagContactIds: number[] | null = null;
  if (opts?.tagIds && opts.tagIds.length > 0) {
    const junctions = await db
      .select()
      .from(contactTags)
      .where(inArray(contactTags.tagId, opts.tagIds));
    tagContactIds = Array.from(new Set(junctions.map(j => j.contactId)));
    if (tagContactIds.length === 0) return [];
  }

  const conditions = [];
  if (opts?.dateFrom) conditions.push(gte(contacts.createdAt, opts.dateFrom));
  if (opts?.dateTo) {
    const endOfDay = new Date(opts.dateTo);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(lte(contacts.createdAt, endOfDay));
  }
  if (tagContactIds !== null) conditions.push(inArray(contacts.id, tagContactIds));

  const query = db.select().from(contacts);
  const filtered = conditions.length > 0
    ? query.where(and(...conditions))
    : query;
  const rows = await filtered.orderBy(desc(contacts.createdAt)).limit(1000);
  if (rows.length === 0) return [];

  // Fetch all tag junctions for these contacts in one query (no N+1)
  const contactIds = rows.map(c => c.id);
  const junctions = await db
    .select({ contactId: contactTags.contactId, tagId: contactTags.tagId })
    .from(contactTags)
    .where(inArray(contactTags.contactId, contactIds));
  const allTagIds = Array.from(new Set(junctions.map(j => j.tagId)));
  const tagRows = allTagIds.length > 0
    ? await db.select().from(tags).where(inArray(tags.id, allTagIds))
    : [];
  const tagMap = new Map(tagRows.map(t => [t.id, t]));
  const junctionMap = new Map<number, Tag[]>();
  for (const j of junctions) {
    const tag = tagMap.get(j.tagId);
    if (!tag) continue;
    if (!junctionMap.has(j.contactId)) junctionMap.set(j.contactId, []);
    junctionMap.get(j.contactId)!.push(tag);
  }
  return rows.map(c => ({ ...c, tags: junctionMap.get(c.id) ?? [] }));
}

export async function bulkDeleteContacts(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Remove junction rows first
  await db.delete(contactTags).where(inArray(contactTags.contactId, ids));
  await db.delete(contacts).where(inArray(contacts.id, ids));
}

export async function bulkAddTagToContacts(contactIds: number[], tagId: number): Promise<void> {
  if (contactIds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get existing junctions to avoid duplicates
  const existing = await db
    .select()
    .from(contactTags)
    .where(and(inArray(contactTags.contactId, contactIds), eq(contactTags.tagId, tagId)));
  const existingIds = new Set(existing.map(j => j.contactId));
  const newRows = contactIds
    .filter(id => !existingIds.has(id))
    .map(contactId => ({ contactId, tagId }));
  if (newRows.length > 0) {
    await db.insert(contactTags).values(newRows);
  }
}

export async function getActiveContactPhones(): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const callPhones = await db.selectDistinct({ phone: callHistory.phone }).from(callHistory);
  const smsPhones = await db.selectDistinct({ phone: smsMessages.phone }).from(smsMessages);
  const all = new Set([...callPhones.map(r => r.phone), ...smsPhones.map(r => r.phone)]);
  return Array.from(all);
}

export async function getContactByPhone(phone: string): Promise<Contact | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
  return rows[0] ?? null;
}

export async function getContactById(id: number): Promise<Contact | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function deleteContact(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(contactTags).where(eq(contactTags.contactId, id));
  await db.delete(contacts).where(eq(contacts.id, id));
}

// ─── SmartList helpers ────────────────────────────────────────────────────────

export async function listSmartlists(userId: number): Promise<Smartlist[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Return own lists + public lists + lists shared with this user
  const all = await db.select().from(smartlists).orderBy(asc(smartlists.createdAt));
  return all.filter(sl => {
    if (sl.userId === userId) return true; // own
    if (sl.isPublic) return true; // shared with everyone
    if (sl.sharedWith) {
      try {
        const ids: number[] = JSON.parse(sl.sharedWith as string);
        if (ids.includes(userId)) return true;
      } catch { /* ignore */ }
    }
    return false;
  });
}

export async function shareSmartlist(
  id: number,
  ownerId: number,
  opts: { isPublic?: boolean; sharedWith?: number[] | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates: Partial<typeof smartlists.$inferInsert> = {};
  if (opts.isPublic !== undefined) updates.isPublic = opts.isPublic;
  if (opts.sharedWith !== undefined) {
    updates.sharedWith = opts.sharedWith === null ? null : JSON.stringify(opts.sharedWith);
  }
  await db.update(smartlists).set(updates).where(and(eq(smartlists.id, id), eq(smartlists.userId, ownerId)));
}

export async function createSmartlist(data: InsertSmartlist): Promise<Smartlist> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(smartlists).values(data);
  // Fetch the most recently created smartlist for this user (TiDB insertId may be bigint)
  const rows = await db
    .select()
    .from(smartlists)
    .where(and(eq(smartlists.userId, data.userId), eq(smartlists.name, data.name)))
    .orderBy(desc(smartlists.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error("Failed to retrieve created smartlist");
  return rows[0];
}

export async function deleteSmartlist(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(smartlists).where(and(eq(smartlists.id, id), eq(smartlists.userId, userId)));
}

// ─── User management helpers ──────────────────────────────────────────────────

export async function listUsers(): Promise<User[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(users).orderBy(asc(users.createdAt));
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function setUserRole(userId: number, role: "user" | "admin"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

// ─── User Tag Permission helpers ──────────────────────────────────────────────

/** Returns the tagIds a user is permitted to see. Empty array = no restrictions applied yet. */
export async function getUserPermittedTagIds(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ tagId: userTagPermissions.tagId })
    .from(userTagPermissions)
    .where(eq(userTagPermissions.userId, userId));
  return rows.map(r => r.tagId);
}

/** Returns a map of userId -> tagId[] for all users (for the admin settings UI). */
export async function getAllUserTagPermissions(): Promise<Map<number, number[]>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(userTagPermissions);
  const map = new Map<number, number[]>();
  for (const r of rows) {
    if (!map.has(r.userId)) map.set(r.userId, []);
    map.get(r.userId)!.push(r.tagId);
  }
  return map;
}

/** Replaces all tag permissions for a user with the provided tagIds. */
export async function setUserTagPermissions(userId: number, tagIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing permissions for this user
  await db.delete(userTagPermissions).where(eq(userTagPermissions.userId, userId));
  // Insert new permissions
  if (tagIds.length > 0) {
    await db.insert(userTagPermissions).values(tagIds.map(tagId => ({ userId, tagId })));
  }
}

// ─── Invite drip sequence helpers ─────────────────────────────────────────────

/** Update inviteSequenceStep and optionally inviteCronTaskUid for a user. */
export async function updateUserInviteStep(
  userId: number,
  step: number,
  cronTaskUid?: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const patch: Partial<typeof users.$inferInsert> = { inviteSequenceStep: step };
  if (cronTaskUid !== undefined) patch.inviteCronTaskUid = cronTaskUid ?? undefined;
  await db.update(users).set(patch).where(eq(users.id, userId));
}

/** Return all users whose invite drip is in progress (step 1–3). */
export async function getUsersPendingDrip(): Promise<User[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(users)
    .where(and(gte(users.inviteSequenceStep, 1), lte(users.inviteSequenceStep, 3)));
}

// ─── Email message helpers ─────────────────────────────────────────────────────

/** List email messages for a given email address, oldest first. */
export async function listEmailMessages(email: string): Promise<EmailMessage[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.email, email))
    .orderBy(asc(emailMessages.createdAt));
}

// ─── Automation helpers ───────────────────────────────────────────────────────

export async function listAutomations(): Promise<Automation[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(automations).orderBy(asc(automations.createdAt));
}

export async function getAutomationById(id: number): Promise<Automation | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  return rows[0];
}

export async function createAutomation(data: InsertAutomation): Promise<Automation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(automations).values(data);
  const rows = await db.select().from(automations).orderBy(desc(automations.id)).limit(1);
  return rows[0];
}

export async function updateAutomation(id: number, data: Partial<InsertAutomation>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(automations).set(data).where(eq(automations.id, id));
}

export async function deleteAutomation(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(automationEnrollments).where(eq(automationEnrollments.automationId, id));
  await db.delete(automationSteps).where(eq(automationSteps.automationId, id));
  await db.delete(automations).where(eq(automations.id, id));
}

/** Replace all steps for an automation (delete + re-insert). */
export async function replaceAutomationSteps(
  automationId: number,
  steps: Omit<InsertAutomationStep, "automationId" | "createdAt">[],
): Promise<AutomationStep[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(automationSteps).where(eq(automationSteps.automationId, automationId));
  if (steps.length === 0) return [];
  await db.insert(automationSteps).values(
    steps.map((s, i) => ({ ...s, automationId, stepOrder: i }))
  );
  return db
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.automationId, automationId))
    .orderBy(asc(automationSteps.stepOrder));
}

export async function getAutomationSteps(automationId: number): Promise<AutomationStep[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(automationSteps)
    .where(eq(automationSteps.automationId, automationId))
    .orderBy(asc(automationSteps.stepOrder));
}

/** Enroll a contact in an automation (skip if already active). */
export async function enrollContact(
  automationId: number,
  contactId: number,
  nextRunAt: number,
  eventTimestamp?: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check for existing active enrollment
  const existing = await db
    .select()
    .from(automationEnrollments)
    .where(
      and(
        eq(automationEnrollments.automationId, automationId),
        eq(automationEnrollments.contactId, contactId),
        eq(automationEnrollments.status, "active"),
      )
    )
    .limit(1);
  if (existing.length > 0) return; // already enrolled
  await db.insert(automationEnrollments).values({
    automationId,
    contactId,
    currentStep: 0,
    nextRunAt,
    eventTimestamp: eventTimestamp ?? null,
    status: "active",
  });
}

/** Return all active enrollments whose nextRunAt is in the past. */
export async function getDueEnrollments(): Promise<AutomationEnrollment[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = Date.now();
  return db
    .select()
    .from(automationEnrollments)
    .where(
      and(
        eq(automationEnrollments.status, "active"),
        lte(automationEnrollments.nextRunAt, now),
      )
    );
}

export async function updateEnrollment(
  id: number,
  patch: Partial<AutomationEnrollment>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(automationEnrollments).set(patch).where(eq(automationEnrollments.id, id));
}

export async function listEnrollmentsForAutomation(
  automationId: number,
): Promise<AutomationEnrollment[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(automationEnrollments)
    .where(eq(automationEnrollments.automationId, automationId))
    .orderBy(desc(automationEnrollments.enrolledAt));
}

/** Return all active automations triggered by 'appointment_booked', optionally filtered by calendarId.
 *  Automations with triggerCalendarId = null match any calendar.
 *  Automations with a specific triggerCalendarId only match that calendar.
 */
export async function getAutomationsForAppointmentBooked(calendarId?: number): Promise<Automation[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.isActive, true),
        eq(automations.triggerType, "appointment_booked"),
      )
    );
  // Filter in JS: null triggerCalendarId = any calendar; specific = must match
  if (calendarId !== undefined) {
    return rows.filter(a => a.triggerCalendarId === null || a.triggerCalendarId === calendarId);
  }
  return rows;
}

/** Return all active automations triggered by a specific tag. */
export async function getAutomationsForTag(tagId: number): Promise<Automation[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.isActive, true),
        eq(automations.triggerTagId, tagId),
      )
    );
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

export async function listCalendars(): Promise<Calendar[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(calendars).orderBy(asc(calendars.createdAt));
}

export async function getCalendarById(id: number): Promise<Calendar | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createCalendar(data: InsertCalendar): Promise<Calendar> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(calendars).values(data);
  const rows = await db.select().from(calendars).where(eq(calendars.name, data.name)).orderBy(desc(calendars.id)).limit(1);
  return rows[0];
}

export async function updateCalendar(id: number, data: Partial<InsertCalendar>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(calendars).set(data).where(eq(calendars.id, id));
}

export async function deleteCalendar(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Remove all appointments in this calendar first
  await db.delete(appointments).where(eq(appointments.calendarId, id));
  await db.delete(calendars).where(eq(calendars.id, id));
}

// ─── Appointment helpers ──────────────────────────────────────────────────────

export async function listAppointments(opts?: {
  calendarIds?: number[];
  from?: number;
  to?: number;
  status?: string;
}): Promise<(Appointment & { contactName: string | null; contactPhone: string | null; timezone: string })[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [];
  if (opts?.calendarIds && opts.calendarIds.length > 0) {
    conditions.push(inArray(appointments.calendarId, opts.calendarIds));
  }
  if (opts?.from) conditions.push(gte(appointments.startAt, opts.from));
  if (opts?.to) conditions.push(lte(appointments.startAt, opts.to));
  if (opts?.status) conditions.push(eq(appointments.status, opts.status));
  const baseQuery = db
    .select({
      id: appointments.id,
      calendarId: appointments.calendarId,
      contactId: appointments.contactId,
      title: appointments.title,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      notes: appointments.notes,
      status: appointments.status,
      timezone: appointments.timezone,
      createdAt: appointments.createdAt,
      updatedAt: appointments.updatedAt,
      contactName: contacts.name,
      contactPhone: contacts.phone,
    })
    .from(appointments)
    .leftJoin(contacts, eq(appointments.contactId, contacts.id))
    .orderBy(asc(appointments.startAt));
  if (conditions.length > 0) {
    return baseQuery.where(and(...conditions));
  }
  return baseQuery;
}

export async function getAppointmentById(id: number): Promise<Appointment | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Find an appointment by its startAt timestamp and optional contactId (for before_event placeholder resolution). */
export async function getAppointmentByEventTimestamp(startAt: number, contactId?: number | null): Promise<Appointment | null> {
  const db = await getDb();
  if (!db) return null;
  const conditions = contactId
    ? and(eq(appointments.startAt, startAt), eq(appointments.contactId, contactId))
    : eq(appointments.startAt, startAt);
  const rows = await db.select().from(appointments).where(conditions).orderBy(desc(appointments.id)).limit(1);
  return rows[0] ?? null;
}

export async function createAppointment(data: InsertAppointment): Promise<Appointment> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(appointments).values(data);
  const rows = await db.select().from(appointments).where(
    and(eq(appointments.calendarId, data.calendarId), eq(appointments.startAt, data.startAt))
  ).orderBy(desc(appointments.id)).limit(1);
  return rows[0];
}

export async function updateAppointment(id: number, data: Partial<InsertAppointment>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(appointments).set(data).where(eq(appointments.id, id));
}

export async function deleteAppointment(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(appointments).where(eq(appointments.id, id));
}

// ─── App Settings helpers ─────────────────────────────────────────────────────

export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(appSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}

// ─── Phone normalisation ───────────────────────────────────────────────────
/**
 * Convert any phone number to E.164 format before passing to Telnyx/Blooio.
 *  04xxxxxxxx  → +614xxxxxxxx  (AU local mobile)
 *  614xxxxxxxx → +614xxxxxxxx  (AU without + prefix)
 *  +614xx…     → unchanged     (already E.164)
 *  10-digit US → +1xxxxxxxxxx
 *  Anything else → strip non-digits, prepend +
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("0") && digits.length === 10) return "+61" + digits.slice(1);
  if (digits.startsWith("61") && digits.length === 11) return "+" + digits;
  if (digits.length === 10 && /^[2-9]/.test(digits)) return "+1" + digits;
  if (raw.startsWith("+")) return raw;
  return "+" + digits;
}

// ─── Automation Execution Logs ────────────────────────────────────────────────
export async function insertExecutionLog(log: InsertAutomationExecutionLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(automationExecutionLogs).values(log);
}

export async function getExecutionLogs(opts: {
  automationId?: number;
  contactId?: number;
  stepType?: string;
  status?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  offset?: number;
}): Promise<AutomationExecutionLog[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (opts.automationId) conditions.push(eq(automationExecutionLogs.automationId, opts.automationId));
  if (opts.contactId)    conditions.push(eq(automationExecutionLogs.contactId, opts.contactId));
  if (opts.stepType)     conditions.push(eq(automationExecutionLogs.stepType, opts.stepType));
  if (opts.status)       conditions.push(eq(automationExecutionLogs.status, opts.status));
  if (opts.fromTs)       conditions.push(gte(automationExecutionLogs.executedAt, opts.fromTs));
  if (opts.toTs)         conditions.push(lte(automationExecutionLogs.executedAt, opts.toTs));
  const q = db.select().from(automationExecutionLogs);
  if (conditions.length) q.where(and(...conditions));
  q.orderBy(desc(automationExecutionLogs.executedAt));
  q.limit(opts.limit ?? 50);
  if (opts.offset) q.offset(opts.offset);
  return q;
}

export async function countExecutionLogs(opts: {
  automationId?: number;
  contactId?: number;
  stepType?: string;
  status?: string;
  fromTs?: number;
  toTs?: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const { count } = await import("drizzle-orm");
  const conditions = [];
  if (opts.automationId) conditions.push(eq(automationExecutionLogs.automationId, opts.automationId));
  if (opts.contactId)    conditions.push(eq(automationExecutionLogs.contactId, opts.contactId));
  if (opts.stepType)     conditions.push(eq(automationExecutionLogs.stepType, opts.stepType));
  if (opts.status)       conditions.push(eq(automationExecutionLogs.status, opts.status));
  if (opts.fromTs)       conditions.push(gte(automationExecutionLogs.executedAt, opts.fromTs));
  if (opts.toTs)         conditions.push(lte(automationExecutionLogs.executedAt, opts.toTs));
  const q = db.select({ total: count() }).from(automationExecutionLogs);
  if (conditions.length) q.where(and(...conditions));
  const rows = await q;
  return rows[0]?.total ?? 0;
}

// ─── What's New (product updates) ─────────────────────────────────────────────

export async function listUpdates(): Promise<Update[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(updates).orderBy(desc(updates.createdAt), desc(updates.id));
}

export async function getDismissedUpdateIds(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ updateId: updateDismissals.updateId })
    .from(updateDismissals)
    .where(eq(updateDismissals.userId, userId));
  return rows.map(r => r.updateId);
}

export async function createUpdate(data: { title: string; body: string }): Promise<Update> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(updates).values({ title: data.title, body: data.body });
  const rows = await db.select().from(updates).where(eq(updates.id, result.insertId)).limit(1);
  return rows[0];
}

export async function updateUpdate(id: number, data: { title: string; body: string }): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(updates).set({ title: data.title, body: data.body }).where(eq(updates.id, id));
}

export async function deleteUpdate(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(updateDismissals).where(eq(updateDismissals.updateId, id));
  await db.delete(updates).where(eq(updates.id, id));
}

// Idempotent: composite PK means re-dismissing an already-dismissed update is a no-op.
export async function dismissUpdatesForUser(userId: number, updateIds: number[]): Promise<void> {
  if (updateIds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const values = updateIds.map(updateId => ({ userId, updateId }));
  await db.insert(updateDismissals).values(values).onDuplicateKeyUpdate({ set: { userId } });
}
