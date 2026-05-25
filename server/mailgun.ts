/**
 * Mailgun email helper.
 * Uses the Mailgun v3 REST API via axios with URL-encoded form data.
 */
import axios from "axios";
import { getDb } from "./db";
import { emailMessages } from "../drizzle/schema";

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY ?? "";
const MAILGUN_DOMAIN  = process.env.MAILGUN_DOMAIN  ?? "hl.scalbl.io";
const MAILGUN_FROM    = process.env.MAILGUN_FROM_EMAIL ?? "henry@scalbl.io";
const MAILGUN_BASE    = "https://api.mailgun.net/v3";

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** Plain-text body */
  text?: string;
  /** HTML body (optional — falls back to text) */
  html?: string;
  /** 'invite' | 'manual' — stored in email_messages.messageType */
  messageType?: string;
  /** Display name for the From header — defaults to 'Henry from Scalbl.io' */
  fromName?: string;
}

/**
 * Send an email via Mailgun and persist the record to email_messages.
 * Returns the Mailgun message ID on success.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<string> {
  const db = await getDb();
  const params = new URLSearchParams();
  const displayName = opts.fromName?.trim() || "Henry from Scalbl.io";
  params.append("from", `${displayName} <${MAILGUN_FROM}>`);
  params.append("to", opts.to);
  params.append("subject", opts.subject);
  if (opts.html) params.append("html", opts.html);
  if (opts.text) params.append("text", opts.text);
  // Disable Mailgun click-tracking so URLs are not rewritten
  params.append("o:tracking-clicks", "no");
  params.append("o:tracking-opens", "no");

  if (!db) throw new Error("[mailgun] DB unavailable");

  let externalId = "";
  let status = "sent";

  try {
    const response = await axios.post<{ id: string; message: string }>(
      `${MAILGUN_BASE}/${MAILGUN_DOMAIN}/messages`,
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")}`,
        },
      }
    );
    externalId = response.data.id ?? "";
  } catch (err: unknown) {
    console.error("[mailgun] send failed:", err);
    status = "failed";
    await db.insert(emailMessages).values({
      email:       opts.to,
      direction:   "outbound",
      subject:     opts.subject,
      body:        opts.text ?? opts.html ?? "",
      status:      "failed",
      messageType: opts.messageType ?? "manual",
    });
    throw err;
  }

  await db.insert(emailMessages).values({
    email:       opts.to,
    direction:   "outbound",
    subject:     opts.subject,
    body:        opts.text ?? opts.html ?? "",
    status,
    externalId,
    messageType: opts.messageType ?? "manual",
  });

  return externalId;
}

/** Build the initial invite email content */
export function buildInviteEmailHtml(params: {
  recipientName: string;
  inviterName: string;
  inviteUrl: string;
}): { subject: string; html: string; text: string } {
  const { recipientName, inviterName, inviteUrl } = params;
  const subject = `You've been invited to OliviaAI by ${inviterName}`;
  const text = `Hi ${recipientName},\n\nYou've been invited to OliviaAI by ${inviterName} to manage your leads. Click the link below to get onboarded and access your leads now:\n\n${inviteUrl}\n\nThis link expires in 7 days.\n\nBest,\nThe OliviaAI Team`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#0f0f0f;color:#e5e5e5;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#1a1a2e;border-radius:12px;padding:40px;border:1px solid rgba(255,255,255,0.08);">
    <h1 style="font-size:28px;font-weight:700;color:#fff;margin:0 0 8px;">OliviaAI</h1>
    <p style="color:#888;font-size:12px;margin:0 0 32px;letter-spacing:2px;text-transform:uppercase;">Outbound Sales</p>
    <p style="font-size:16px;line-height:1.6;color:#d0d0d0;">Hi <strong>${recipientName}</strong>,</p>
    <p style="font-size:16px;line-height:1.6;color:#d0d0d0;">You've been invited to <strong>OliviaAI</strong> by <strong>${inviterName}</strong> to manage your leads. Click below to get onboarded and access your leads now.</p>
    <div style="text-align:center;margin:36px 0;">
      <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">Get Started →</a>
    </div>
    <p style="font-size:13px;color:#666;text-align:center;">This link expires in 7 days.</p>
  </div>
</body></html>`;
  return { subject, html, text };
}

/** Build the 1-hour follow-up email */
export function buildFollowUp1Html(params: { recipientName: string; inviteUrl: string }): { subject: string; html: string; text: string } {
  const { recipientName, inviteUrl } = params;
  const subject = `Don't forget to join OliviaAI`;
  const text = `${recipientName}, don't forget to join OliviaAI to manage your leads with Scalbl.io\n\n${inviteUrl}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#0f0f0f;color:#e5e5e5;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#1a1a2e;border-radius:12px;padding:40px;border:1px solid rgba(255,255,255,0.08);">
    <h1 style="font-size:28px;font-weight:700;color:#fff;margin:0 0 32px;">OliviaAI</h1>
    <p style="font-size:16px;line-height:1.6;color:#d0d0d0;"><strong>${recipientName}</strong>, don't forget to join OliviaAI to manage your leads with <strong>Scalbl.io</strong></p>
    <div style="text-align:center;margin:36px 0;">
      <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">Access Your Leads →</a>
    </div>
  </div>
</body></html>`;
  return { subject, html, text };
}

/** Build the 24hr / 48hr reminder email */
export function buildReminderHtml(params: { recipientName: string; inviteUrl: string; dayNumber: number }): { subject: string; html: string; text: string } {
  const { recipientName, inviteUrl, dayNumber } = params;
  const subject = `Reminder: Your OliviaAI invite is waiting`;
  const text = `${recipientName}, your OliviaAI invite is still waiting. Join now to manage your leads with Scalbl.io:\n\n${inviteUrl}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;background:#0f0f0f;color:#e5e5e5;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#1a1a2e;border-radius:12px;padding:40px;border:1px solid rgba(255,255,255,0.08);">
    <h1 style="font-size:28px;font-weight:700;color:#fff;margin:0 0 32px;">OliviaAI</h1>
    <p style="font-size:14px;color:#f59e0b;font-weight:600;margin:0 0 16px;">Day ${dayNumber} Reminder</p>
    <p style="font-size:16px;line-height:1.6;color:#d0d0d0;"><strong>${recipientName}</strong>, your OliviaAI invite is still waiting. Join now to manage your leads with <strong>Scalbl.io</strong>.</p>
    <div style="text-align:center;margin:36px 0;">
      <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">Join OliviaAI →</a>
    </div>
  </div>
</body></html>`;
  return { subject, html, text };
}
