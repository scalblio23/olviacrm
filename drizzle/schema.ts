import { bigint, boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  inviteToken: varchar("inviteToken", { length: 128 }),
  inviteSequenceStep: int("inviteSequenceStep").default(0).notNull(),
  inviteCronTaskUid: varchar("inviteCronTaskUid", { length: 65 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Tags — named labels for grouping contacts/leads
export const tags = mysqlTable("tags", {
  id:        int("id").autoincrement().primaryKey(),
  name:      varchar("name", { length: 100 }).notNull().unique(),
  color:     varchar("color", { length: 32 }).default("#6366f1").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Tag = typeof tags.$inferSelect;
export type InsertTag = typeof tags.$inferInsert;

// Lead sessions — one per CSV upload
export const leadSessions = mysqlTable("lead_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 64 }).notNull().unique(),
  fileName: varchar("fileName", { length: 255 }),
  tagId: int("tagId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LeadSession = typeof leadSessions.$inferSelect;

// Individual leads within a session
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }),
  phone: varchar("phone", { length: 64 }).notNull(),
  company: varchar("company", { length: 255 }),
  extraData: json("extraData"),
  disposition: mysqlEnum("disposition", [
    "none", "answered", "no_answer", "callback", "appointment_set",
  ]).default("none").notNull(),
  notes: text("notes").default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

// Call history — one record per call attempt per lead
export const callHistory = mysqlTable("call_history", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId"),
  sessionId: varchar("sessionId", { length: 64 }),
  phone: varchar("phone", { length: 64 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  direction: mysqlEnum("direction", ["outbound", "inbound"]).default("outbound").notNull(),
  durationSeconds: int("durationSeconds").default(0).notNull(),
  disposition: mysqlEnum("disposition", [
    "none", "answered", "no_answer", "callback", "appointment_set",
  ]).default("none").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CallHistoryRecord = typeof callHistory.$inferSelect;
export type InsertCallHistory = typeof callHistory.$inferInsert;

// SMS messages — persisted outbound + inbound for two-way threads
export const smsMessages = mysqlTable("sms_messages", {
  id:         int("id").autoincrement().primaryKey(),
  phone:      varchar("phone", { length: 64 }).notNull(),
  direction:  mysqlEnum("direction", ["outbound", "inbound"]).notNull(),
  body:       text("body").notNull(),
  status:     varchar("status", { length: 32 }).default("sent").notNull(),
  externalId: varchar("externalId", { length: 128 }),
  channel:    mysqlEnum("channel", ["sms", "imessage"]).default("sms").notNull(),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
});
export type SmsMessage = typeof smsMessages.$inferSelect;
export type InsertSmsMessage = typeof smsMessages.$inferInsert;

// Contacts — saved contacts with name, phone, and optional details
export const contacts = mysqlTable("contacts", {
  id:         int("id").autoincrement().primaryKey(),
  name:       varchar("name", { length: 255 }).notNull(),
  phone:      varchar("phone", { length: 64 }).notNull().unique(),
  email:      varchar("email", { length: 320 }),
  company:    varchar("company", { length: 255 }),
  notes:      text("notes").default(""),
  source:     varchar("source", { length: 255 }),
  criteria1:  varchar("criteria1", { length: 255 }),
  criteria2:  varchar("criteria2", { length: 255 }),
  criteria3:  varchar("criteria3", { length: 255 }),
  criteria4:  varchar("criteria4", { length: 255 }),
  criteria5:  varchar("criteria5", { length: 255 }),
  status:     varchar("status", { length: 64 }),
  outcome:    text("outcome"),
  timezone:   varchar("timezone", { length: 64 }),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
  updatedAt:  timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

// SmartLists — saved filter rule sets for the contacts table
export const smartlists = mysqlTable("smartlists", {
  id:          int("id").autoincrement().primaryKey(),
  userId:      int("userId").notNull(),
  name:        varchar("name", { length: 100 }).notNull(),
  filterRules: json("filterRules").notNull(),
  isPublic:    boolean("isPublic").default(false).notNull(),
  sharedWith:  text("sharedWith"),  // JSON array of user IDs, null = not shared
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
});
export type Smartlist = typeof smartlists.$inferSelect;
export type InsertSmartlist = typeof smartlists.$inferInsert;

// Contact <-> Tag junction table (many-to-many)
export const contactTags = mysqlTable("contact_tags", {
  contactId: int("contactId").notNull(),
  tagId:     int("tagId").notNull(),
});
export type ContactTag = typeof contactTags.$inferSelect;

// User <-> Tag permission junction table
export const userTagPermissions = mysqlTable("user_tag_permissions", {
  id:        int("id").autoincrement().primaryKey(),
  userId:    int("userId").notNull(),
  tagId:     int("tagId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UserTagPermission = typeof userTagPermissions.$inferSelect;
export type InsertUserTagPermission = typeof userTagPermissions.$inferInsert;

// Email messages — two-way email threads (Mailgun)
export const emailMessages = mysqlTable("email_messages", {
  id:          int("id").autoincrement().primaryKey(),
  email:       varchar("email", { length: 320 }).notNull(),
  direction:   mysqlEnum("direction", ["outbound", "inbound"]).notNull(),
  subject:     varchar("subject", { length: 500 }).notNull(),
  body:        text("body").notNull(),
  status:      varchar("status", { length: 32 }).default("sent").notNull(),
  externalId:  varchar("externalId", { length: 255 }),
  messageType: varchar("messageType", { length: 32 }).default("manual").notNull(),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
});
export type EmailMessage = typeof emailMessages.$inferSelect;
export type InsertEmailMessage = typeof emailMessages.$inferInsert;

// ─── Automations ─────────────────────────────────────────────────────────────
// An automation is a named sequence of steps triggered by a condition (e.g. tag added).
export const automations = mysqlTable("automations", {
  id:           int("id").autoincrement().primaryKey(),
  name:         varchar("name", { length: 255 }).notNull(),
  /** 'tag_added' | 'appointment_booked' */
  triggerType:  varchar("triggerType", { length: 64 }).default("tag_added").notNull(),
  /** The tag ID that triggers this automation (null = any tag) */
  triggerTagId: int("triggerTagId"),
  /** The calendar ID that triggers this automation (null = any calendar, only used for appointment_booked) */
  triggerCalendarId: int("triggerCalendarId"),
  isActive:     boolean("isActive").default(true).notNull(),
  /** IANA timezone for this automation, e.g. 'Australia/Adelaide' */
  timezone:     varchar("timezone", { length: 64 }).default("UTC").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Automation = typeof automations.$inferSelect;
export type InsertAutomation = typeof automations.$inferInsert;

// Each step in an automation — wait, SMS, or email.
export const automationSteps = mysqlTable("automation_steps", {
  id:           int("id").autoincrement().primaryKey(),
  automationId: int("automationId").notNull(),
  /** 0-based ordering within the automation */
  stepOrder:    int("stepOrder").notNull(),
  /** 'wait' | 'sms' | 'email' */
  stepType:     varchar("stepType", { length: 32 }).notNull(),
  // ── Wait step fields ──────────────────────────────────────────────────────
  waitValue:    int("waitValue"),
  /** 'minutes' | 'hours' | 'days' */
  waitUnit:     varchar("waitUnit", { length: 16 }),
  /** 'delay' = wait X time after previous step
   *  'before_event' = fire X time BEFORE a named event */
  waitMode:     varchar("waitMode", { length: 32 }).default("delay"),
  /** Name of the event used when waitMode='before_event' (e.g. 'appointment') */
  eventType:    varchar("eventType", { length: 64 }),
  // ── SMS step fields ───────────────────────────────────────────────────────
  smsBody:      text("smsBody"),
  // ── Email step fields ─────────────────────────────────────────────────────
  emailSubject: varchar("emailSubject", { length: 500 }),
  emailBody:    text("emailBody"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
});
export type AutomationStep = typeof automationSteps.$inferSelect;
export type InsertAutomationStep = typeof automationSteps.$inferInsert;

// Tracks each contact's progress through an automation.
export const automationEnrollments = mysqlTable("automation_enrollments", {
  id:           int("id").autoincrement().primaryKey(),
  automationId: int("automationId").notNull(),
  contactId:    int("contactId").notNull(),
  /** Index of the next step to execute (0-based) */
  currentStep:  int("currentStep").default(0).notNull(),
  /** UTC epoch ms — when the next step should fire */
  nextRunAt:    bigint("nextRunAt", { mode: "number" }),
  /** UTC epoch ms — the event time used for before_event wait resolution (e.g. appointment startAt) */
  eventTimestamp: bigint("eventTimestamp", { mode: "number" }),
  /** 'active' | 'completed' | 'cancelled' */
  status:       varchar("status", { length: 32 }).default("active").notNull(),
  enrolledAt:   timestamp("enrolledAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AutomationEnrollment = typeof automationEnrollments.$inferSelect;
export type InsertAutomationEnrollment = typeof automationEnrollments.$inferInsert;
// ─── App Settings (key-value store for global config) ────────────────────────
export const appSettings = mysqlTable("app_settings", {
  key:       varchar("key", { length: 128 }).primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;

// ─── Calendars ──────────────────────────────────────────────────────────────────
// A calendar belongs to a user(type='user') or is a custom named calendar (type='custom').
export const calendars = mysqlTable("calendars", {
  id:        int("id").autoincrement().primaryKey(),
  /** Display name, e.g. "John Smith" or "Harborview Bookings" */
  name:      varchar("name", { length: 255 }).notNull(),
  /** 'user' = auto-created per agent, 'custom' = user-defined */
  type:      varchar("type", { length: 32 }).default("custom").notNull(),
  /** userId of the owning agent (null for shared custom calendars) */
  ownerId:   int("ownerId"),
  /** Hex color for calendar dot/badge, e.g. "#6366f1" */
  color:     varchar("color", { length: 32 }).default("#6366f1").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Calendar = typeof calendars.$inferSelect;
export type InsertCalendar = typeof calendars.$inferInsert;

// ─── Appointments ─────────────────────────────────────────────────────────────
export const appointments = mysqlTable("appointments", {
  id:         int("id").autoincrement().primaryKey(),
  calendarId: int("calendarId").notNull(),
  /** Optional link to a saved contact */
  contactId:  int("contactId"),
  /** Display name (may differ from contact name if manually typed) */
  title:      varchar("title", { length: 255 }).notNull(),
  /** UTC epoch ms — start of appointment */
  startAt:    bigint("startAt", { mode: "number" }).notNull(),
  /** UTC epoch ms — end of appointment */
  endAt:      bigint("endAt", { mode: "number" }).notNull(),
  notes:      text("notes"),
  /** 'scheduled' | 'completed' | 'cancelled' | 'no_show' */
  status:     varchar("status", { length: 32 }).default("scheduled").notNull(),
  /** IANA timezone for this appointment, e.g. 'Australia/Adelaide' */
  timezone:   varchar("timezone", { length: 64 }).default("UTC").notNull(),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
  updatedAt:  timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = typeof appointments.$inferInsert;

// ─── Automation Execution Logs ───────────────────────────────────────────────
// One row per step executed (or skipped) by the automation engine.
export const automationExecutionLogs = mysqlTable("automation_execution_logs", {
  id:           int("id").autoincrement().primaryKey(),
  automationId: int("automationId").notNull(),
  enrollmentId: int("enrollmentId").notNull(),
  contactId:    int("contactId").notNull(),
  /** 0-based index of the step within the automation */
  stepIndex:    int("stepIndex").notNull(),
  /** 'sms' | 'email' | 'imessage' | 'wait' */
  stepType:     varchar("stepType", { length: 32 }).notNull(),
  /** 'executed' | 'skipped' | 'failed' | 'waiting' */
  status:       varchar("status", { length: 32 }).default("executed").notNull(),
  /** Short human-readable description, e.g. email subject or SMS preview */
  detail:       varchar("detail", { length: 500 }),
  executedAt:   bigint("executedAt", { mode: "number" }).notNull(),
});
export type AutomationExecutionLog = typeof automationExecutionLogs.$inferSelect;
export type InsertAutomationExecutionLog = typeof automationExecutionLogs.$inferInsert;
