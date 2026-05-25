/**
 * Universal placeholder system for OliviaAI / Loop
 *
 * Supported tokens (double-brace syntax):
 *   {{first_name}}           — contact's first name
 *   {{last_name}}            — contact's last name
 *   {{full_name}}            — contact's full name
 *   {{phone}}                — contact's phone number
 *   {{email}}                — contact's email address
 *   {{company}}              — contact's company name
 *   {{appointment_title}}    — appointment title/name
 *   {{appointment_date}}     — appointment date (e.g. "Wednesday, May 14, 2026")
 *   {{appointment_time}}     — appointment time (e.g. "2:30 PM")
 *   {{appointment_timezone}} — appointment timezone (e.g. "America/New_York")
 *
 * Usage:
 *   import { resolvePlaceholders, PLACEHOLDERS } from "@/../../shared/placeholders";
 *   const body = resolvePlaceholders("Hi {{first_name}}!", { full_name: "John Smith", phone: "+61400000000" });
 */

export interface PlaceholderContext {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  company?: string;
  // Appointment-specific
  appointment_title?: string;
  appointment_date?: string;
  appointment_time?: string;
  appointment_timezone?: string;
}

/** Contact-only placeholder tokens */
export const CONTACT_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{first_name}}", label: "First Name" },
  { token: "{{last_name}}",  label: "Last Name"  },
  { token: "{{full_name}}",  label: "Full Name"  },
  { token: "{{phone}}",      label: "Phone"      },
  { token: "{{email}}",      label: "Email"      },
  { token: "{{company}}",    label: "Company"    },
];

/** Appointment-specific placeholder tokens */
export const APPOINTMENT_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{appointment_title}}",    label: "Appt Title"    },
  { token: "{{appointment_date}}",     label: "Appt Date"     },
  { token: "{{appointment_time}}",     label: "Appt Time"     },
  { token: "{{appointment_timezone}}", label: "Appt Timezone" },
];

/** All supported placeholder tokens with labels for the UI picker */
export const PLACEHOLDERS: { token: string; label: string }[] = [
  ...CONTACT_PLACEHOLDERS,
  ...APPOINTMENT_PLACEHOLDERS,
];

/**
 * Resolve all {{token}} placeholders in a string using the provided context.
 * Missing values are replaced with an empty string.
 */
export function resolvePlaceholders(text: string, ctx: PlaceholderContext): string {
  // Derive first/last from full_name if not explicitly provided
  const full = ctx.full_name ?? "";
  const parts = full.trim().split(/\s+/);
  const first = ctx.first_name ?? (parts[0] ?? "");
  const last  = ctx.last_name  ?? (parts.length > 1 ? parts.slice(1).join(" ") : "");

  return text
    .replace(/\{\{first_name\}\}/g, first)
    .replace(/\{\{last_name\}\}/g,  last)
    .replace(/\{\{full_name\}\}/g,  full)
    .replace(/\{\{phone\}\}/g,      ctx.phone   ?? "")
    .replace(/\{\{email\}\}/g,      ctx.email   ?? "")
    .replace(/\{\{company\}\}/g,    ctx.company ?? "")
    .replace(/\{\{appointment_title\}\}/g,    ctx.appointment_title    ?? "")
    .replace(/\{\{appointment_date\}\}/g,     ctx.appointment_date     ?? "")
    .replace(/\{\{appointment_time\}\}/g,     ctx.appointment_time     ?? "")
    .replace(/\{\{appointment_timezone\}\}/g, ctx.appointment_timezone ?? "");
}

/**
 * Build a PlaceholderContext from a contact-like object.
 * Works with both DB rows and frontend contact shapes.
 */
export function contactToContext(contact: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
}): PlaceholderContext {
  return {
    full_name: contact.name   ?? undefined,
    phone:     contact.phone  ?? undefined,
    email:     contact.email  ?? undefined,
    company:   contact.company ?? undefined,
  };
}

/**
 * Build appointment placeholder fields from an appointment-like object.
 * eventTimestamp is a UTC ms epoch; timezone is an IANA timezone string.
 */
export function appointmentToContext(appt: {
  title?: string | null;
  startAt?: number | null;
  timezone?: string | null;
}): Partial<PlaceholderContext> {
  if (!appt.startAt) return {};
  const tz = appt.timezone ?? "UTC";
  const date = new Date(appt.startAt);

  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: tz,
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: tz,
  });

  return {
    appointment_title:    appt.title    ?? undefined,
    appointment_date:     dateStr,
    appointment_time:     timeStr,
    appointment_timezone: tz,
  };
}
