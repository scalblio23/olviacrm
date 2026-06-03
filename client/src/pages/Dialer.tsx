import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  DragStartEvent, DragEndEvent, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { trpc } from "@/lib/trpc";
import { normalizeAuPhone } from "@shared/phone";
import { useTheme } from "@/contexts/ThemeContext";
import { useTelnyxPhone } from "@/hooks/useTelnyxPhone";
import type { UseTelnyxPhoneReturn } from "@/hooks/useTelnyxPhone";
import {
  Phone, MessageSquare, Upload, Search, ChevronRight, ChevronLeft,
  CheckCircle2, PhoneMissed, Clock, CalendarCheck, FileText,
  X, Loader2, PhoneCall, Sun, Moon, Send, Hash,
  Mic, PhoneOff, ArrowUpRight, ArrowDownLeft, PhoneForwarded, Pause, Play, LogOut,
  ChevronDown, ChevronUp, ChevronsUpDown, History, Users, Settings, UserPlus, UserCheck, Mail, Building2,
  Tag, Plus, Filter, CircleDot, UserMinus, Globe, Trash2, Zap, CalendarDays,
  LayoutGrid, List as ListIcon, Share2, Sparkles, Columns3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WhatsNewMenu, WhatsNewAdmin } from "@/components/WhatsNew";
import type { Lead, CallHistoryRecord, Contact, Tag as TagType } from "../../../drizzle/schema";
import AutomationsPanel from "./AutomationsPanel";
import AppointmentsPanel from "./AppointmentsPanel";
import { PlaceholderPicker } from "@/components/PlaceholderPicker";
import { AIChatBox } from "@/components/AIChatBox";
import PowerDialler from "@/components/PowerDialler";
import type { Message as AIChatMessage } from "@/components/AIChatBox";

// ─── Types ────────────────────────────────────────────────────────────────────

type Disposition = "none" | "answered" | "no_answer" | "callback" | "appointment_set";

// SmsMessage comes from the DB via tRPC getSmsThread
interface ChatMessage {
  id: string;
  direction: "outbound" | "inbound";
  text: string;
  timestamp: Date;
  status: "sending" | "sent" | "failed";
  channel?: "sms" | "imessage";
}

interface ActiveContact {
  phone: string;
  name: string;
  leadId?: number;
  sessionId?: string;
}

// Unified timeline event — either a call or an SMS
type TimelineEvent =
  | { kind: "call"; record: CallHistoryRecord }
  | { kind: "sms";  msg: ChatMessage };

// CSV field mapping target fields
const CONTACT_FIELDS = [
  { value: "skip",        label: "Skip" },
  { value: "name",        label: "Name" },
  { value: "phone",       label: "Phone" },
  { value: "email",       label: "Email" },
  { value: "company",     label: "Company" },
  { value: "source",      label: "Source" },
  { value: "criteria1",   label: "Criteria 1" },
  { value: "criteria2",   label: "Criteria 2" },
  { value: "criteria3",   label: "Criteria 3" },
  { value: "criteria4",   label: "Criteria 4" },
  { value: "criteria5",   label: "Criteria 5" },
  { value: "closer",           label: "Closer" },
  { value: "priceQuoted",      label: "Price Quoted" },
  { value: "callRecordingUrl", label: "Call Recording URL" },
  { value: "objections",       label: "Objections" },
  { value: "dealResult",       label: "Deal Result" },
  { value: "status",           label: "Status" },
  { value: "tags",             label: "Tags" },
  { value: "createdAt",   label: "Date Created ★" },
] as const;

type ContactFieldKey = typeof CONTACT_FIELDS[number]["value"];

// ─── Contact table columns (visibility toggleable + persisted per user) ──────────
const CONTACT_COLUMNS: { col: string; label: string; w: string }[] = [
  { col: "name",      label: "Name",            w: "w-44" },
  { col: "phone",     label: "Phone",           w: "w-32" },
  { col: "email",     label: "Email",           w: "w-44" },
  { col: "outcome",   label: "Notes / Outcome", w: "w-48" },
  { col: "company",   label: "Company",         w: "w-32" },
  { col: "source",    label: "Source",          w: "w-28" },
  { col: "criteria1", label: "Criteria 1",      w: "w-28" },
  { col: "criteria2", label: "Criteria 2",      w: "w-28" },
  { col: "criteria3", label: "Criteria 3",      w: "w-28" },
  { col: "criteria4", label: "Criteria 4",      w: "w-28" },
  { col: "criteria5", label: "Criteria 5",      w: "w-28" },
  { col: "timezone",  label: "Timezone",        w: "w-40" },
  { col: "status",    label: "Status",          w: "w-28" },
  { col: "dealResult",       label: "Deal Result",        w: "w-28" },
  { col: "closer",           label: "Closer",             w: "w-32" },
  { col: "priceQuoted",      label: "Price Quoted",       w: "w-28" },
  { col: "callRecordingUrl", label: "Call Recording URL", w: "w-44" },
  { col: "objections",       label: "Objections",         w: "w-48" },
  { col: "tags",      label: "Tags",            w: "w-36" },
  { col: "createdAt", label: "Date Created",    w: "w-28" },
];
// Pipeline fields are available to toggle on but hidden by default.
const HIDDEN_BY_DEFAULT_COLUMNS = ["dealResult", "closer", "priceQuoted", "callRecordingUrl", "objections"];
const DEFAULT_CONTACT_COLUMNS = CONTACT_COLUMNS.map(c => c.col).filter(col => !HIDDEN_BY_DEFAULT_COLUMNS.includes(col));
// Always-on columns can't be toggled off, so the table can never be emptied of its key identifiers.
const ALWAYS_ON_COLUMNS = ["name", "phone"];

// Tag color palette
const TAG_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#06b6d4",
];

const CONTACT_STATUSES: { value: string; label: string; color: string; bg: string }[] = [
  { value: "new",              label: "New",              color: "#ffffff", bg: "#64748b" },
  { value: "contacted",       label: "Contacted",        color: "#ffffff", bg: "#2563eb" },
  { value: "interested",       label: "Interested",       color: "#ffffff", bg: "#16a34a" },
  { value: "not_interested",   label: "Not Interested",   color: "#ffffff", bg: "#dc2626" },
  { value: "callback",         label: "Callback",         color: "#000000", bg: "#facc15" },
  { value: "appointment_set",  label: "Appointment Set",  color: "#ffffff", bg: "#0d9488" },
  { value: "do_not_call",      label: "Do Not Call",      color: "#ffffff", bg: "#7c3aed" },
  // ── Scalbl.io sales-pipeline statuses ──
  { value: "upcoming",         label: "Upcoming",         color: "#ffffff", bg: "#0ea5e9" },
  { value: "show",             label: "Show",             color: "#ffffff", bg: "#16a34a" },
  { value: "no_show",          label: "No Show",          color: "#ffffff", bg: "#dc2626" },
  { value: "not_booked",       label: "Not Booked",       color: "#ffffff", bg: "#64748b" },
  { value: "won",              label: "Won",              color: "#ffffff", bg: "#15803d" },
  { value: "lost",             label: "Lost",             color: "#ffffff", bg: "#b91c1c" },
  { value: "pending",          label: "Pending",          color: "#000000", bg: "#f59e0b" },
];
function getStatusMeta(status: string | null | undefined) {
  return CONTACT_STATUSES.find(s => s.value === status) ?? null;
}
// Resolve a free-text CSV status (label or slug) to a canonical status value, or undefined if unknown.
function resolveStatusValue(raw: string | undefined | null): string | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return undefined;
  const slug = v.replace(/[\s/]+/g, "_").replace(/_+/g, "_");
  const match = CONTACT_STATUSES.find(
    s => s.value === slug || s.value === v || s.label.toLowerCase() === v
  );
  return match?.value;
}

// Deal result — distinct from free-text `outcome` notes; drives the WON/LOST/PENDING counters.
const DEAL_RESULTS: { value: string; label: string; color: string; bg: string }[] = [
  { value: "won",     label: "Won",     color: "#ffffff", bg: "#15803d" },
  { value: "lost",    label: "Lost",    color: "#ffffff", bg: "#b91c1c" },
  { value: "pending", label: "Pending", color: "#000000", bg: "#f59e0b" },
];
function getDealResultMeta(v: string | null | undefined) {
  return DEAL_RESULTS.find(d => d.value === v) ?? null;
}

const DISPOSITIONS: { value: Disposition; label: string; icon: React.ReactNode }[] = [
  { value: "answered",        label: "Answered",        icon: <CheckCircle2 size={14} /> },
  { value: "no_answer",       label: "No Answer",       icon: <PhoneMissed  size={14} /> },
  { value: "callback",        label: "Callback",        icon: <Clock        size={14} /> },
  { value: "appointment_set", label: "Appt Set",        icon: <CalendarCheck size={14} /> },
];

function dispositionLabel(d: Disposition) {
  return DISPOSITIONS.find((x) => x.value === d)?.label ?? "New";
}

// ─── Timer helpers ────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function useCallTimer(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [active]);

  return elapsed;
}

// ─── CSV Parser (RFC 4180 compliant — handles quoted fields, embedded commas, CRLF) ────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Tokenise the raw text into a 2D array of cells, respecting quoted fields
  function tokenise(raw: string): string[][] {
    const result: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (inQuotes) {
        if (ch === '"') {
          if (raw[i + 1] === '"') { cell += '"'; i += 2; continue; } // escaped quote
          inQuotes = false; i++; continue;
        }
        cell += ch; i++;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { row.push(cell.trim()); cell = ""; i++; continue; }
        if (ch === '\r' && raw[i + 1] === '\n') {
          row.push(cell.trim()); result.push(row); row = []; cell = ""; i += 2; continue;
        }
        if (ch === '\n' || ch === '\r') {
          row.push(cell.trim()); result.push(row); row = []; cell = ""; i++; continue;
        }
        cell += ch; i++;
      }
    }
    // flush last cell/row
    if (cell.trim() || row.length > 0) { row.push(cell.trim()); result.push(row); }
    return result;
  }

  const grid = tokenise(text.trim());
  if (grid.length < 2) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    // skip completely empty rows
    if (cells.every((c) => !c.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

// Auto-detect a sensible default mapping for a CSV header
function autoDetectField(header: string): ContactFieldKey {
  const h = header.toLowerCase();
  if (/phone|mobile|tel|number|cell/i.test(h)) return "phone";
  if (/^name$|full.?name|first.?name/i.test(h)) return "name";
  if (/email/i.test(h)) return "email";
  if (/company|org|business|employer/i.test(h)) return "company";
  if (/source/i.test(h)) return "source";
  if (/criteria.?1|crit.?1/i.test(h)) return "criteria1";
  if (/criteria.?2|crit.?2/i.test(h)) return "criteria2";
  if (/criteria.?3|crit.?3/i.test(h)) return "criteria3";
  if (/criteria.?4|crit.?4/i.test(h)) return "criteria4";
  if (/criteria.?5|crit.?5/i.test(h)) return "criteria5";
  if (/closer|closed.?by|rep|agent/i.test(h)) return "closer";
  if (/price|quote|amount|value|deal.?size/i.test(h)) return "priceQuoted";
  if (/recording|fathom|call.?url|drive.?link/i.test(h)) return "callRecordingUrl";
  if (/objection/i.test(h)) return "objections";
  if (/deal.?result|won.?lost|result/i.test(h)) return "dealResult";
  if (/status|stage|no.?show|show/i.test(h)) return "status";
  if (/^tags?$|niche|category/i.test(h)) return "tags";
  if (/date.?created|created.?at|created.?date|date.?added|added.?date|^date$/i.test(h)) return "createdAt";
  return "skip";
}

// ─── Phone Status Pill ────────────────────────────────────────────────────────

function PhoneStatusPill({
  phoneState, isMuted, error, callElapsed, onInit, onHangup, onToggleMute,
}: {
  phoneState: string; isMuted: boolean; error: string | null;
  callElapsed: number;
  onInit: () => void; onHangup: () => void; onToggleMute: () => void;
}) {
  if (phoneState === "idle") {
    return (
      <button onClick={onInit}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-xs text-primary hover:bg-primary/10 transition-all">
        <Mic size={12} /> Connect Mic
      </button>
    );
  }
  if (phoneState === "initializing") {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Connecting…
      </div>
    );
  }
  if (phoneState === "error") {
    return (
      <button onClick={onInit}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive hover:bg-destructive/10 transition-all"
        title={error ?? "Error"}>
        <PhoneOff size={12} /> Retry
      </button>
    );
  }
  if (phoneState === "active") {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onToggleMute}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
            isMuted ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-border bg-muted text-muted-foreground hover:text-foreground"
          }`}>
          <Mic size={12} /> {isMuted ? "Unmute" : "Mute"}
        </button>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {formatDuration(callElapsed)}
        </div>
      </div>
    );
  }
  // ready / ended / reconnecting
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      {phoneState === "reconnecting" ? "Reconnecting…" : phoneState === "ended" ? "Call ended" : "Ready"}
    </div>
  );
}

// ─── Conference Panel (browser-only 3-way) ────────────────────────────────────

function ConferencePanel({
  phone, customerPhone, customerName,
}: {
  phone: UseTelnyxPhoneReturn;
  customerPhone: string;
  customerName?: string;
}) {
  const [targetNumber, setTargetNumber] = useState("");
  const [warm, setWarm] = useState(true);
  const [busy, setBusy] = useState(false);

  const inConference = !!phone.conferenceToken;
  const participants = phone.conferenceParticipants;
  const hasTarget = participants.some((p) => p.role === "target" && p.connected);
  const anyHeld   = participants.some((p) => p.onHold);

  const run = useCallback(async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try { await fn(); }
    catch (e) { toast.error(`${label} failed: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(false); }
  }, []);

  // Not yet in a conference (call started but conference token not assigned yet — transient)
  // or phone is idle. Show a minimal placeholder.
  if (!inConference) {
    // Conference starts with the call itself now, so this state is brief/transient.
    // Only show anything if phone is truly idle (no call active).
    const inCall = ["connecting", "ringing", "active", "reconnecting"].includes(phone.phoneState);
    if (!inCall) return null;
    // Call is connecting but conference token not set yet — show a waiting indicator.
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" /> Setting up 3-way…
      </span>
    );
  }

  const roleLabel = (p: { role: string; number: string }) =>
    p.role === "agent" ? "You"
    : p.role === "customer" ? (customerName || p.number || "Customer")
    : (p.number || "Target");

  return (
    <div className="w-full mt-2 rounded-xl border border-border bg-card/60 p-3 space-y-3">
      {/* Participants */}
      <div className="space-y-1.5">
        {participants.map((p, i) => (
          <div key={`${p.role}-${i}`} className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? (p.onHold ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40"}`} />
            <span className="flex-1 truncate text-foreground">{roleLabel(p)}</span>
            <span className="text-muted-foreground">
              {!p.connected ? "ringing…" : p.onHold ? "on hold" : "live"}
            </span>
            {p.connected && p.role !== "agent" && (
              <>
                <button
                  onClick={() => run(() => phone.setParticipantHold(p.role as "customer" | "target", !p.onHold), "Hold")}
                  disabled={busy}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  title={p.onHold ? "Resume" : "Hold"}
                >
                  {p.onHold ? <Play size={12} /> : <Pause size={12} />}
                </button>
                <button
                  onClick={() => run(() => phone.removeParticipant(p.role as "customer" | "target"), "Remove")}
                  disabled={busy}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  title="Remove from call"
                >
                  <UserMinus size={12} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add a target */}
      {!hasTarget && (
        <div className="flex items-center gap-1.5">
          <Input
            value={targetNumber}
            onChange={(e) => setTargetNumber(e.target.value)}
            placeholder="Transfer to number…"
            className="h-8 text-xs"
          />
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0" title="Warm: put customer on hold so you can brief the other person first">
            <Checkbox checked={warm} onCheckedChange={(v) => setWarm(!!v)} className="h-3.5 w-3.5" />
            Warm
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !targetNumber.trim()}
            onClick={() => run(async () => { await phone.addTarget(targetNumber.trim(), warm); setTargetNumber(""); }, "Add")}
            className="h-8 gap-1 shrink-0"
          >
            <UserPlus size={12} /> Add
          </Button>
        </div>
      )}

      {/* Merge (when someone is held) */}
      {hasTarget && anyHeld && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => run(() => phone.mergeConference(), "Merge")}
          className="w-full h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          <PhoneForwarded size={13} /> Merge everyone
        </Button>
      )}

      {/* Leave / End */}
      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run(() => phone.leaveConference(), "Leave")}
          className="flex-1 h-8 gap-1.5"
          title="Drop out — the other parties stay connected"
        >
          <LogOut size={12} /> Leave (keep others)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run(() => phone.endConference(), "End")}
          className="flex-1 h-8 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <PhoneOff size={12} /> End all
        </Button>
      </div>
    </div>
  );
}

// ─── Lead List Item ───────────────────────────────────────────────────────────

function LeadListItem({ lead, selected, onClick }: { lead: Lead; selected: boolean; onClick: () => void }) {
  const disp = lead.disposition as Disposition;
  const badgeColor: Record<Disposition, string> = {
    none:            "bg-muted text-muted-foreground",
    answered:        "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    no_answer:       "bg-red-500/15 text-red-600 dark:text-red-400",
    callback:        "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    appointment_set: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  };
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all hover:bg-accent/50 ${selected ? "bg-accent" : ""}`}
    >
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
        {(lead.name || lead.phone).slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{lead.name || lead.phone}</p>
        {lead.name && <p className="text-xs text-muted-foreground font-mono truncate">{lead.phone}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeColor[disp]}`}>
          {dispositionLabel(disp)}
        </span>
        <ChevronRight size={12} className="text-muted-foreground/50" />
      </div>
    </button>
  );
}

// ─── Global Call History Row ──────────────────────────────────────────────────

function GlobalCallRow({
  record, active, onClick,
}: {
  record: CallHistoryRecord; active: boolean; onClick: () => void;
}) {
  const isOut = record.direction !== "inbound";
  const displayName = record.contactName || record.phone;
  const timeStr = new Date(record.startedAt).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all hover:bg-accent/50 ${active ? "bg-accent" : ""}`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        isOut ? "bg-emerald-500/10" : "bg-blue-500/10"
      }`}>
        {isOut
          ? <ArrowUpRight size={14} className="text-emerald-600 dark:text-emerald-400" />
          : <ArrowDownLeft size={14} className="text-blue-600 dark:text-blue-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{record.phone}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-muted-foreground">{timeStr}</p>
        <p className="text-[10px] text-muted-foreground/70 font-mono">{formatDuration(record.durationSeconds)}</p>
      </div>
    </button>
  );
}

// ─── Unified Conversation Timeline ───────────────────────────────────────────

function ConversationTimeline({
  events, sending, onSend, contactName, contactPhone, iMessageMode, onToggleChannel,
}: {
  events: TimelineEvent[];
  sending: boolean;
  onSend: (text: string) => void;
  contactName: string;
  contactPhone: string;
  iMessageMode: boolean;
  onToggleChannel: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Ask AI
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const aiMutation = trpc.conversations.generateMessage.useMutation({
    onSuccess: (data) => { setDraft(data.text); setAiOpen(false); setAiPrompt(""); },
    onError: (e) => { toast.error("AI error: " + e.message); },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <MessageSquare size={16} className="text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground/60">
              Calls and messages with {contactName || contactPhone} will appear here
            </p>
          </div>
        ) : (
          events.map((ev, i) => {
            if (ev.kind === "call") {
              const r = ev.record;
              const isOut = r.direction !== "inbound";
              const disp = r.disposition as Disposition;
              const dispColors: Record<Disposition, string> = {
                none:            "text-muted-foreground",
                answered:        "text-emerald-600 dark:text-emerald-400",
                no_answer:       "text-red-500",
                callback:        "text-amber-600 dark:text-amber-400",
                appointment_set: "text-blue-600 dark:text-blue-400",
              };
              return (
                <div key={`call-${r.id}-${i}`} className="flex justify-center">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50 border border-border text-xs max-w-sm w-full">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      isOut ? "bg-emerald-500/10" : "bg-blue-500/10"
                    }`}>
                      {isOut
                        ? <ArrowUpRight size={11} className="text-emerald-600 dark:text-emerald-400" />
                        : <ArrowDownLeft size={11} className="text-blue-600 dark:text-blue-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-foreground font-medium">
                        {isOut ? "Outbound call" : "Inbound call"}
                      </span>
                      {" · "}
                      <span className="font-mono">{formatDuration(r.durationSeconds)}</span>
                      {disp !== "none" && (
                        <span className={`ml-1.5 font-medium ${dispColors[disp]}`}>
                          · {dispositionLabel(disp)}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground/60 shrink-0">
                      {new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              );
            }
            // SMS / iMessage
            const msg = ev.msg;
            const isIMsg = msg.channel === "imessage";
            return (
              <div key={`sms-${msg.id}-${i}`} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  msg.direction === "outbound"
                    ? isIMsg
                      ? "bg-blue-500 text-white rounded-br-sm"
                      : "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}>
                  {isIMsg && msg.direction === "outbound" && (
                    <p className="text-[9px] font-semibold uppercase tracking-wide mb-0.5 text-white/70">iMessage</p>
                  )}
                  {isIMsg && msg.direction === "inbound" && (
                    <p className="text-[9px] font-semibold uppercase tracking-wide mb-0.5 text-blue-500">iMessage</p>
                  )}
                  <p className="leading-relaxed">{msg.text}</p>
                  <p className={`text-[10px] mt-1 ${msg.direction === "outbound" ? (isIMsg ? "text-white/60" : "text-primary-foreground/60") : "text-muted-foreground"}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {msg.status === "failed" && " · Failed"}
                    {msg.status === "sending" && " · Sending…"}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      {/* Message input */}
      <div className="px-4 pb-4 pt-2 border-t border-border shrink-0">
        {/* iMessage toggle row */}
        <div className="flex items-center gap-2 mb-2">
          <Switch
            id="imessage-toggle"
            checked={iMessageMode}
            onCheckedChange={onToggleChannel}
            className={iMessageMode ? "data-[state=checked]:bg-blue-500" : ""}
          />
          <label
            htmlFor="imessage-toggle"
            className={`text-xs font-medium cursor-pointer select-none ${iMessageMode ? "text-blue-500" : "text-muted-foreground"}`}
          >
            {iMessageMode ? "iMessage" : "SMS"}
          </label>
        </div>
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              // Shift+Enter inserts a new line (default textarea behaviour — no override needed)
            }}
            placeholder={iMessageMode ? "Send iMessage… (Shift+Enter for new line)" : "Send SMS… (Shift+Enter for new line)"}
            rows={1}
            className="flex-1 min-h-[36px] max-h-[120px] text-sm bg-input border-border text-foreground placeholder:text-muted-foreground resize-none overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <Button
            size="sm"
            onClick={send}
            disabled={!draft.trim() || sending}
            className={`h-9 w-9 p-0 shrink-0 ${iMessageMode ? "bg-blue-500 hover:bg-blue-600 text-white border-0" : ""}`}
          >
             {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <PlaceholderPicker
            targetRef={textareaRef}
            onInsert={(token) => setDraft(prev => prev + token)}
          />
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 gap-1 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 h-7 px-2 text-xs"
            onClick={() => setAiOpen(v => !v)}
          >
            <Sparkles size={12} /> Ask AI
          </Button>
        </div>
        {aiOpen && (
          <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2 space-y-2">
            <p className="text-[10px] text-violet-300 font-medium">Describe the message you want to send…</p>
            <div className="flex gap-2">
              <Textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (aiPrompt.trim()) aiMutation.mutate({ prompt: aiPrompt.trim(), channel: "sms", contactName: contactName || undefined, contactPhone: contactPhone || undefined }); } }}
                placeholder="e.g. Follow up on yesterday's call and ask if they're still interested"
                rows={2}
                className="flex-1 text-xs resize-none bg-background/50 border-violet-500/30 focus:border-violet-400"
                disabled={aiMutation.isPending}
              />
              <button
                onClick={() => { if (aiPrompt.trim()) aiMutation.mutate({ prompt: aiPrompt.trim(), channel: "sms", contactName: contactName || undefined, contactPhone: contactPhone || undefined }); }}
                disabled={!aiPrompt.trim() || aiMutation.isPending}
                className="self-end w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center transition-colors shrink-0"
              >
                {aiMutation.isPending ? <Loader2 size={12} className="animate-spin text-white" /> : <Send size={12} className="text-white" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
// ─── CSV Field Mapping Modal ──────────────────────────────────────────────────

function CsvMappingModal({
  open,
  headers,
  previewRows,
  allRows,
  totalRows,
  allTags,
  onImport,
  onCancel,
  onCreateTag,
}: {
  open: boolean;
  headers: string[];
  previewRows: Record<string, string>[];
  allRows: Record<string, string>[];
  totalRows: number;
  allTags: TagType[];
  onImport: (mapping: Record<string, ContactFieldKey>, tagId: number) => void;
  onCancel: () => void;
  onCreateTag: (name: string, color: string) => Promise<TagType>;
}) {
  const [mapping, setMapping] = useState<Record<string, ContactFieldKey>>(() => {
    const m: Record<string, ContactFieldKey> = {};
    headers.forEach((h) => { m[h] = autoDetectField(h); });
    return m;
  });
  const [selectedTagId, setSelectedTagId] = useState<string>("none");
  const [newTagName, setNewTagName]       = useState("");
  const [newTagColor, setNewTagColor]     = useState(TAG_COLORS[0]);
  const [showNewTag, setShowNewTag]       = useState(false);
  const [creatingTag, setCreatingTag]     = useState(false);

  // Reset when modal opens with new headers
  useEffect(() => {
    if (open) {
      const m: Record<string, ContactFieldKey> = {};
      headers.forEach((h) => { m[h] = autoDetectField(h); });
      setMapping(m);
      setSelectedTagId("none");
      setNewTagName("");
      setNewTagColor(TAG_COLORS[0]);
      setShowNewTag(false);
    }
  }, [open, headers]);

  const hasPhone = Object.values(mapping).includes("phone");
  const hasDateCreated = Object.values(mapping).includes("createdAt");

  // Immediately create the tag, select it in the dropdown, and close the form
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    try {
      const tag = await onCreateTag(newTagName.trim(), newTagColor);
      setSelectedTagId(String(tag.id));
      setNewTagName("");
      setShowNewTag(false);
      toast.success(`Tag "${tag.name}" created`);
    } catch {
      toast.error("Failed to create tag");
    } finally {
      setCreatingTag(false);
    }
  };

  const hasTag = selectedTagId !== "none";

  const handleImport = () => {
    if (!hasTag || !hasPhone || !hasDateCreated) { return; } // guard — button should already be disabled
    const finalTagId = parseInt(selectedTagId, 10);
    onImport(mapping, finalTagId);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
        <DialogContent className="sm:max-w-2xl w-full max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload size={16} />
            Map CSV Fields
          </DialogTitle>
        </DialogHeader>

        {/* Tag assignment */}
        <div className="space-y-3 pb-3 border-b border-border">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assign Tag to This Upload <span className="text-destructive">*</span></Label>
            <p className="text-xs text-muted-foreground mt-0.5">Required — all contacts in this CSV will be tagged for easy filtering</p>
          </div>
          {/* Existing tag selector */}
          <div className="flex items-center gap-2">
              <Select value={selectedTagId} onValueChange={setSelectedTagId}>
              <SelectTrigger className="flex-1 h-9 text-sm">
                <SelectValue placeholder="Select a tag (required)" />
              </SelectTrigger>
              <SelectContent>
                {allTags.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setShowNewTag((v) => !v)}
            >
              <Plus size={13} /> New Tag
            </Button>
          </div>

          {/* Inline new-tag form — shown when New Tag is clicked */}
          {showNewTag && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Create New Tag</p>
              <Input
                placeholder="Tag name (e.g. Client A, Campaign 1)"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="h-9 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagName.trim()) {
                    e.preventDefault();
                    handleCreateTag();
                  }
                }}
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground">Color:</span>
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewTagColor(c)}
                    className={`w-5 h-5 rounded-full transition-all ${
                      newTagColor === c ? "ring-2 ring-offset-2 ring-foreground/30 scale-110" : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={!newTagName.trim() || creatingTag}
                  onClick={handleCreateTag}
                >
                  {creatingTag
                    ? <><Loader2 size={12} className="animate-spin" /> Creating…</>
                    : <><Plus size={12} /> Create Tag</>
                  }
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowNewTag(false); setNewTagName(""); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Column mapping */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Map CSV Columns to Fields</Label>
          <div className="space-y-2">
            {headers.map((header) => {
              const preview = previewRows[0]?.[header] ?? "";
              return (
                <div key={header} className="grid grid-cols-[1fr_auto_140px] items-center gap-3 py-1.5 px-3 rounded-lg bg-muted/40 border border-border/50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{header}</p>
                    {preview && (
                      <p className="text-xs text-muted-foreground/70 truncate font-mono">{preview}</p>
                    )}
                  </div>
                  <div className="text-muted-foreground/40 text-xs">→</div>
                  <Select
                    value={mapping[header] ?? "skip"}
                    onValueChange={(v) => setMapping((prev) => ({ ...prev, [header]: v as ContactFieldKey }))}
                  >
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTACT_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Phone normalization preview — original → E.164 */}
        {(() => {
          const phoneHeader = Object.entries(mapping).find(([, f]) => f === "phone")?.[0];
          if (!phoneHeader) return null;
          const samples = allRows
            .map((r) => (r[phoneHeader] ?? "").trim())
            .filter((v) => v !== "")
            .slice(0, 5)
            .map((original) => ({ original, normalized: normalizeAuPhone(original) }));
          const invalidCount = allRows.reduce((n, r) => n + (normalizeAuPhone(r[phoneHeader]) === null ? 1 : 0), 0);
          return (
            <div className="space-y-2 pt-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone Preview</Label>
              <div className="rounded-lg border border-border/50 bg-muted/40 divide-y divide-border/40">
                {samples.map(({ original, normalized }, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-mono">
                    <span className="text-muted-foreground truncate">{original}</span>
                    <span className="text-muted-foreground/40">→</span>
                    {normalized
                      ? <span className="text-foreground truncate">{normalized}</span>
                      : <span className="text-red-500 dark:text-red-400 italic shrink-0">skipped — invalid</span>}
                  </div>
                ))}
              </div>
              {invalidCount > 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <strong>{invalidCount}</strong> of {totalRows} row{totalRows !== 1 ? "s" : ""} will be skipped — invalid phone.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">All {totalRows} phone number{totalRows !== 1 ? "s" : ""} normalize cleanly.</p>
              )}
            </div>
          );
        })()}
         {!hasPhone && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            Map at least one column to <strong>Phone</strong> to import contacts.
          </p>
        )}
        {!hasDateCreated && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <strong>Date Created is required</strong> — please map a CSV column to <strong>Date Created ★</strong> before importing.
          </p>
        )}
        {!hasTag && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            A <strong>tag is required</strong> before importing — select an existing tag or create a new one above.
          </p>
        )}
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            disabled={!hasPhone || !hasDateCreated || !hasTag || creatingTag}
            onClick={handleImport}
          >
            {creatingTag ? <><Loader2 size={13} className="animate-spin mr-1.5" /> Creating tag…</> : `Import ${totalRows} contact${totalRows !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settings Panel ─────────────────────────────────────────────────────────

function SettingsPanel({ allTags }: { allTags: TagType[] }) {
  const { data: currentUser, isLoading: meLoading } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });
  const isAdmin = currentUser?.role === 'admin';

  // Admin: list all users with their permitted tag IDs
  const { data: userList = [], refetch: refetchUsers } = trpc.admin.listUsers.useQuery(undefined, {
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const setPermsMutation = trpc.admin.setUserTagPermissions.useMutation({
    onSuccess: () => { void refetchUsers(); toast.success('Permissions saved'); },
    onError: (e) => toast.error(e.message),
  });
  const setRoleMutation = trpc.admin.setUserRole.useMutation({
    onSuccess: () => { void refetchUsers(); toast.success('Role updated'); },
    onError: (e) => toast.error(e.message),
  });
  const deleteUserMutation = trpc.admin.deleteUser.useMutation({
    onSuccess: () => { void refetchUsers(); toast.success('User removed'); },
    onError: (e) => toast.error(e.message),
  });
  const createUserMutation = trpc.admin.createUser.useMutation({
    onSuccess: (data) => {
      void refetchUsers();
      toast.success('User created — invite SMS sent!');
      // Show invite URL as fallback in case SMS fails
      if (data.inviteUrl) {
        toast.info(`Invite link: ${data.inviteUrl}`, { duration: 15000 });
      }
      setNewName(''); setNewEmail(''); setNewPhone(''); setNewRole('user');
      setShowAddUser(false);
    },
    onError: (e) => toast.error(e.message),
  });

  // Add User form state
  const [showAddUser, setShowAddUser] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole,  setNewRole]  = useState<'user' | 'admin'>('user');
  const [countryCode, setCountryCode] = useState('+61');

  const COUNTRY_CODES = [
    { code: '+61', flag: '🇦🇺', label: 'AU' },
    { code: '+1',  flag: '🇺🇸', label: 'US' },
    { code: '+44', flag: '🇬🇧', label: 'GB' },
    { code: '+64', flag: '🇳🇿', label: 'NZ' },
  ];

  function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    const fullPhone = `${countryCode}${newPhone.replace(/^0/, '')}`;
    createUserMutation.mutate({
      name: newName.trim(),
      email: newEmail.trim(),
      phone: fullPhone,
      role: newRole,
      origin: window.location.origin,
    });
  }

  // Which user's permission panel is open
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  // Local optimistic tag selection per user (userId -> Set<tagId>)
  const [localPerms, setLocalPerms] = useState<Record<number, Set<number>>>({});

  // Stable key derived from user IDs + their tag IDs — prevents infinite loop from new array refs
  const userListKey = userList.map(u => `${u.id}:${[...u.permittedTagIds].sort().join(',')}`).join('|');
  // Sync localPerms from server data when userList actually changes
  useEffect(() => {
    const next: Record<number, Set<number>> = {};
    for (const u of userList) {
      next[u.id] = new Set(u.permittedTagIds);
    }
    setLocalPerms(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userListKey]);

  function toggleTagForUser(userId: number, tagId: number) {
    setLocalPerms(prev => {
      const current = new Set(prev[userId] ?? []);
      if (current.has(tagId)) current.delete(tagId); else current.add(tagId);
      return { ...prev, [userId]: current };
    });
  }

  function savePerms(userId: number) {
    const tagIds = Array.from(localPerms[userId] ?? []);
    setPermsMutation.mutate({ userId, tagIds });
  }

  if (meLoading || !currentUser) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <p className="text-base font-semibold gradient-text">User Management</p>
          <p className="text-xs text-muted-foreground mt-0.5">Loading…</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <p className="text-base font-semibold text-foreground">Settings</p>
          <p className="text-xs text-muted-foreground mt-0.5">User permissions</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
            <Settings size={22} className="text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Admin access required</p>
            <p className="text-xs text-muted-foreground mt-1">Only admins can manage user permissions. Contact your administrator.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0 bg-background/70 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold gradient-text">User Management</p>
            <p className="text-xs text-muted-foreground mt-0.5">{userList.length} user{userList.length !== 1 ? 's' : ''} — click to manage tag permissions</p>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowAddUser(v => !v)}
          >
            <UserPlus size={13} />
            Add User
          </Button>
        </div>
      </div>

      {/* What's New management (admin only) */}
      <WhatsNewAdmin />

      {/* Add User form */}
      {showAddUser && (
        <div className="border-b border-border bg-card/60 backdrop-blur-sm px-6 py-4">
          <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <UserPlus size={14} className="text-primary" /> New User
          </p>
          <form onSubmit={handleAddUser} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Full Name</Label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Email</Label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="jane@company.com"
                  required
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Phone (for SMS invite)</Label>
              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="w-24 h-8 text-sm shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_CODES.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.flag} {c.label} {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  placeholder="412 345 678"
                  required
                  className="h-8 text-sm flex-1"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Role:</Label>
                <div className="flex gap-1">
                  {(['user', 'admin'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewRole(r)}
                      className={`text-xs px-2.5 py-1 rounded-md transition-colors capitalize ${
                        newRole === r
                          ? r === 'admin' ? 'bg-primary text-primary-foreground font-semibold' : 'bg-foreground text-background font-semibold'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >{r}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAddUser(false)}>Cancel</Button>
                <Button type="submit" size="sm" className="h-7 text-xs gap-1" disabled={createUserMutation.isPending}>
                  {createUserMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Globe size={11} />}
                  Send Invite
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* User list */}
      <div className="flex-1 overflow-y-auto">
        {userList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
            <Users size={32} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No users yet — add one above.</p>
            <p className="text-xs text-muted-foreground/70">They'll receive an SMS with their login link.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {userList.map((u) => {
              const isExpanded = expandedUserId === u.id;
              const isSelf = u.id === currentUser?.id;
              const userTagSet = localPerms[u.id] ?? new Set<number>();
              const permCount = userTagSet.size;
              const hasChanges = JSON.stringify(Array.from(userTagSet).sort()) !== JSON.stringify(Array.from(u.permittedTagIds ?? []).sort());

              return (
                <div key={u.id} className="">
                  {/* User row */}
                  <button
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-accent/50 transition-colors text-left"
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                  >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-primary">
                        {(u.name ?? u.email ?? '?')[0].toUpperCase()}
                      </span>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground truncate">{u.name ?? 'Unnamed'}</span>
                        {u.role === 'admin' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase tracking-wide">Admin</span>
                        )}
                        {isSelf && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">You</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email ?? 'No email'}</p>
                    </div>
                    {/* Permission summary + delete */}
                    <div className="shrink-0 flex items-center gap-2">
                      {u.role !== 'admin' && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          permCount === 0
                            ? 'bg-red-500/10 text-red-500'
                            : 'bg-emerald-500/10 text-emerald-500'
                        }`}>
                          {permCount === 0 ? 'No access' : `${permCount} tag${permCount !== 1 ? 's' : ''}`}
                        </span>
                      )}
                      {u.role === 'admin' && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Full access</span>
                      )}
                      {!isSelf && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Remove ${u.name ?? u.email}?`)) deleteUserMutation.mutate({ userId: u.id });
                          }}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                          title="Remove user"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                      <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Expanded permission editor */}
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-1 bg-muted/20 border-t border-border/50">
                      {/* Role toggle */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => !isSelf && setRoleMutation.mutate({ userId: u.id, role: 'user' })}
                            disabled={isSelf}
                            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                              u.role === 'user'
                                ? 'bg-foreground text-background font-semibold'
                                : 'bg-muted text-muted-foreground hover:bg-accent'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >User</button>
                          <button
                            onClick={() => !isSelf && setRoleMutation.mutate({ userId: u.id, role: 'admin' })}
                            disabled={isSelf}
                            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                              u.role === 'admin'
                                ? 'bg-primary text-primary-foreground font-semibold'
                                : 'bg-muted text-muted-foreground hover:bg-accent'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >Admin</button>
                        </div>
                      </div>

                      {/* Tag permissions (only for non-admin users) */}
                      {u.role !== 'admin' && (
                        <>
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Visible Tags</p>
                          {allTags.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No tags created yet.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {allTags.map(tag => {
                                const isSelected = userTagSet.has(tag.id);
                                return (
                                  <button
                                    key={tag.id}
                                    onClick={() => toggleTagForUser(u.id, tag.id)}
                                    className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                                      isSelected
                                        ? 'border-transparent text-white font-medium'
                                        : 'border-border text-muted-foreground hover:border-border/80 bg-background'
                                    }`}
                                    style={isSelected ? { backgroundColor: tag.color } : {}}
                                  >
                                    {isSelected && <CheckCircle2 size={10} />}
                                    {tag.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {allTags.length > 0 && (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={!hasChanges || setPermsMutation.isPending}
                                onClick={() => savePerms(u.id)}
                              >
                                {setPermsMutation.isPending ? <Loader2 size={11} className="animate-spin mr-1" /> : null}
                                Save permissions
                              </Button>
                              {permCount === 0 && (
                                <span className="text-xs text-red-500">⚠ No tags selected — user will see no contacts</span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      {u.role === 'admin' && (
                        <p className="text-xs text-muted-foreground italic">Admins have unrestricted access to all contacts.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dialer ──────────────────────────────────────────────────────────────

export default function Dialer() {
  const { theme, toggleTheme } = useTheme();
  const phone = useTelnyxPhone();

  // Lead selector state
  const [sessionId,      setSessionId]      = useState<string | null>(
    () => localStorage.getItem("loop_sessionId")
  );
  const [sessionTagId, setSessionTagId] = useState<number | null>(
    () => { const v = localStorage.getItem("loop_sessionTagId"); return v ? Number(v) : null; }
  );
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [search,         setSearch]         = useState("");
  const [isDragging,     setIsDragging]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSV mapping modal state
  const [csvPending, setCsvPending] = useState<{ file: File; headers: string[]; rows: Record<string, string>[] } | null>(null);

  // Manual dial state
  const [manualPhone,   setManualPhone]   = useState("");
  const [manualName,    setManualName]    = useState("");
  const [manualCountry, setManualCountry] = useState<"AU" | "US">("AU");

  const COUNTRIES = [
    { code: "AU" as const, flag: "🇦🇺", dialCode: "+61", label: "Australia" },
    { code: "US" as const, flag: "🇺🇸", dialCode: "+1",  label: "United States" },
  ];
  const selectedCountry = COUNTRIES.find((c) => c.code === manualCountry) ?? COUNTRIES[0];

  const buildFullPhone = () => {
    const raw = manualPhone.trim();
    if (!raw) return "";
    if (raw.startsWith("+")) return raw;
    const stripped = manualCountry === "AU" && raw.startsWith("0") ? raw.slice(1) : raw;
    return `${selectedCountry.dialCode}${stripped}`;
  };

  // Active contact for conversation window
  const [activeContact, setActiveContact] = useState<ActiveContact | null>(null);
  // iMessage toggle
  const [iMessageMode, setIMessageMode] = useState(false);
  // Contact dialog
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    phone: "",
    name: "", email: "", company: "", notes: "",
    source: "", criteria1: "", criteria2: "", criteria3: "", criteria4: "", criteria5: "",
    tagIds: [] as number[],
    status: "" as string,
    outcome: "" as string,
    timezone: "" as string,
    closer: "" as string,
    priceQuoted: "" as string,
    callRecordingUrl: "" as string,
    objections: "" as string,
    dealResult: "" as string,
  });
  // Left sidebar tab — persisted in localStorage
  const [leftTab, setLeftTab] = useState<"conversations" | "contacts" | "settings" | "automations" | "appointments" | "power">(
    () => (localStorage.getItem("loop_leftTab") as "conversations" | "contacts" | "settings" | "automations" | "appointments" | "power") || "conversations"
  );
  const setLeftTabPersist = (tab: "conversations" | "contacts" | "settings" | "automations" | "appointments" | "power") => {
    localStorage.setItem("loop_leftTab", tab);
    setLeftTab(tab);
  };
  // Contacts table state
  const [contactSearch, setContactSearch] = useState("");
  const [contactTagFilter, setContactTagFilter] = useState<number | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [contactDateFrom, setContactDateFrom] = useState("");
  const [contactDateTo, setContactDateTo] = useState("");
  const [contactTagFilters, setContactTagFilters] = useState<number[]>([]);
  const [showContactFilters, setShowContactFilters] = useState(false);
  const [bulkTagDialogOpen, setBulkTagDialogOpen] = useState(false);
  const [bulkTagId, setBulkTagId] = useState<string>("none");
  const [bulkShowNewTag, setBulkShowNewTag] = useState(false);
  const [bulkNewTagName, setBulkNewTagName] = useState("");
  const [bulkNewTagColor, setBulkNewTagColor] = useState(TAG_COLORS[0]);
  const [bulkRemoveTagDialogOpen, setBulkRemoveTagDialogOpen] = useState(false);
  const [bulkStatusDialogOpen, setBulkStatusDialogOpen] = useState(false);
  // Notion-style filter rules
  type FilterOperator = "contains" | "not_contains" | "is" | "is_not" | "is_empty" | "is_not_empty" | "before" | "after" | "has_tag" | "no_tag";
  type FilterRule = { id: string; field: string; operator: FilterOperator; value: string };
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  // Contacts table sort state
  type SortDir = "asc" | "desc";
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Contacts view mode: list or kanban — persisted in localStorage
  const [contactsViewMode, setContactsViewMode] = useState<"list" | "kanban">(() => {
    try { return (localStorage.getItem("contacts-view-mode") as "list" | "kanban") ?? "list"; } catch { return "list"; }
  });
  const setContactsView = (m: "list" | "kanban") => {
    setContactsViewMode(m);
    try { localStorage.setItem("contacts-view-mode", m); } catch {}
  };
  // Contact table column visibility — persisted server-side per user.
  const prefsUtils = trpc.useUtils();
  const { data: userPrefs } = trpc.preferences.get.useQuery(undefined, { staleTime: 60_000, retry: false });
  const updatePrefsMutation = trpc.preferences.update.useMutation({
    onSettled: () => prefsUtils.preferences.get.invalidate(),
  });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_CONTACT_COLUMNS);
  // Always-on columns are forced present and ordered first.
  const withAlwaysOn = (cols: string[]) => [
    ...ALWAYS_ON_COLUMNS.filter(c => CONTACT_COLUMNS.some(col => col.col === c)),
    ...cols.filter(c => !ALWAYS_ON_COLUMNS.includes(c)),
  ];
  // Hydrate from the server preference once it loads.
  useEffect(() => {
    const stored = (userPrefs as { contactColumns?: unknown } | undefined)?.contactColumns;
    if (Array.isArray(stored)) {
      const valid = stored.filter((c): c is string => typeof c === "string" && CONTACT_COLUMNS.some(col => col.col === c));
      if (valid.length > 0) setVisibleColumns(withAlwaysOn(valid));
    }
  }, [userPrefs]);
  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const toggleColumn = (col: string) => {
    if (ALWAYS_ON_COLUMNS.includes(col)) return; // pinned — can't be toggled off
    setVisibleColumns(prev => {
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      updatePrefsMutation.mutate({ contactColumns: next });
      return next;
    });
  };
  // AI chat panel state for Contacts tab
  const [showContactsAI, setShowContactsAI] = useState(false);
  const [contactsAIMessages, setContactsAIMessages] = useState<AIChatMessage[]>([]);
  const [isContactsAILoading, setIsContactsAILoading] = useState(false);

  // Ref so the call-logging useEffect always reads the latest contact
  const activeContactRef = useRef<ActiveContact | null>(null);

  // Optimistic outbound messages (keyed by phone)
  const [pendingMessages, setPendingMessages] = useState<Record<string, ChatMessage[]>>({});

  // Notes per lead (keyed by leadId)
  const [notesMap,   setNotesMap]   = useState<Record<number, string>>({});
  const [notesValue, setNotesValue] = useState("");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Disposition per lead (local optimistic)
  const [dispositionMap, setDispositionMap] = useState<Record<number, Disposition>>({});
  const dispositionMapRef = useRef<Record<number, Disposition>>({});

  // Call tracking
  const callStartRef          = useRef<number | null>(null);
  const callStartedContactRef = useRef<ActiveContact | null>(null);

  // tRPC
  const uploadMutation      = trpc.leads.upload.useMutation();
  const smsMutation         = trpc.telnyx.sms.useMutation();
  const blooioMutation      = trpc.blooio.send.useMutation();
  // ─── Email state ──────────────────────────────────────────────────────────
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const emailBodyRef = useRef<HTMLTextAreaElement>(null);
  const [emailAiOpen, setEmailAiOpen] = useState(false);
  const [emailAiPrompt, setEmailAiPrompt] = useState('');

  // Tags
  const { data: allTags = [], refetch: refetchTags } = trpc.tags.list.useQuery(undefined, { staleTime: 60_000 });
  const createTagMutation = trpc.tags.create.useMutation({
    onSuccess: () => void refetchTags(),
  });

  // Current user + tag permissions
  const { data: currentUser } = trpc.auth.me.useQuery(undefined, { staleTime: 120_000 });
  const { data: myPermittedTagIds } = trpc.admin.myPermittedTagIds.useQuery(undefined, { staleTime: 60_000 });
  // myPermittedTagIds === null means admin (unrestricted); array means restricted

  // Contacts (with server-side date/tag filters)
  const contactFiltersInput = useMemo(() => ({
    dateFrom: contactDateFrom ? new Date(contactDateFrom).getTime() : undefined,
    dateTo:   contactDateTo   ? new Date(contactDateTo).getTime()   : undefined,
    tagIds:   contactTagFilters.length > 0 ? contactTagFilters : undefined,
  }), [contactDateFrom, contactDateTo, contactTagFilters]);
  const { data: contactList = [], refetch: refetchContactsRaw } = trpc.contacts.list.useQuery(
    contactFiltersInput,
    { staleTime: 30_000 }
  );
  // Accurate pipeline counts over ALL contacts (the list above is capped at 1000 rows).
  const { data: contactStats, refetch: refetchContactStats } = trpc.contacts.stats.useQuery(undefined, { staleTime: 30_000 });
  // Refresh the list and the counter aggregates together.
  const refetchContacts = useCallback(() => {
    void refetchContactsRaw();
    void refetchContactStats();
  }, [refetchContactsRaw, refetchContactStats]);
  // Smart sort helpers
  function detectSortType(values: string[]): "date" | "number" | "text" {
    const nonEmpty = values.filter(v => v && v !== "—");
    if (nonEmpty.length === 0) return "text";
    // Date: ISO 8601, DD/MM/YYYY, MM/DD/YYYY, or common date strings
    const dateRe = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/;
    const dateCount = nonEmpty.filter(v => dateRe.test(v.trim()) && !isNaN(Date.parse(v))).length;
    if (dateCount / nonEmpty.length >= 0.6) return "date";
    // Number: plain numeric strings (allow commas/decimals)
    const numCount = nonEmpty.filter(v => /^-?[\d,]+(\.\d+)?$/.test(v.trim())).length;
    if (numCount / nonEmpty.length >= 0.6) return "number";
    return "text";
  }

  function getContactField(c: Contact, col: string): string {
    const map: Record<string, string> = {
      name:      (c as any).name      ?? "",
      phone:     (c as any).phone     ?? "",
      email:     (c as any).email     ?? "",
      company:   (c as any).company   ?? "",
      source:    (c as any).source    ?? "",
      criteria1: (c as any).criteria1 ?? "",
      criteria2: (c as any).criteria2 ?? "",
      criteria3: (c as any).criteria3 ?? "",
      criteria4: (c as any).criteria4 ?? "",
      criteria5: (c as any).criteria5 ?? "",
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : "",
      status:    (c as any).status ?? "",
      outcome:   (c as any).outcome ?? "",
      closer:           (c as any).closer ?? "",
      priceQuoted:      (c as any).priceQuoted ?? "",
      callRecordingUrl: (c as any).callRecordingUrl ?? "",
      objections:       (c as any).objections ?? "",
      dealResult:       (c as any).dealResult ?? "",
    };
    return map[col] ?? "";
  }

  // Apply Notion-style filter rules client-side
  const filteredContactList = useMemo(() => {
    const base = contactSearch.trim()
      ? contactList.filter(c => {
          const q = contactSearch.toLowerCase();
          return (
            (c.name ?? "").toLowerCase().includes(q) ||
            (c.phone ?? "").toLowerCase().includes(q) ||
            (c.email ?? "").toLowerCase().includes(q) ||
            (c.company ?? "").toLowerCase().includes(q)
          );
        })
      : contactList;
    if (filterRules.length === 0) return base;
    return base.filter(c => {
      return filterRules.every(rule => {
        if (rule.field === "tags") {
          const tagList: TagType[] = (c as any).tags ?? [];
          const tagNames = tagList.map((t: TagType) => t.name.toLowerCase());
          const tagIds = tagList.map((t: TagType) => t.id);
          if (rule.operator === "has_tag") {
            // value is tag id as string
            return rule.value ? tagIds.includes(Number(rule.value)) : tagNames.length > 0;
          }
          if (rule.operator === "no_tag") {
            return rule.value ? !tagIds.includes(Number(rule.value)) : tagNames.length === 0;
          }
          if (rule.operator === "is_empty") return tagNames.length === 0;
          if (rule.operator === "is_not_empty") return tagNames.length > 0;
          return true;
        }
        const raw = getContactField(c, rule.field);
        const val = raw.toLowerCase();
        const ruleVal = rule.value.toLowerCase();
        switch (rule.operator) {
          case "contains":     return val.includes(ruleVal);
          case "not_contains": return !val.includes(ruleVal);
          case "is":           return val === ruleVal;
          case "is_not":       return val !== ruleVal;
          case "is_empty":     return !raw.trim();
          case "is_not_empty": return !!raw.trim();
          case "before": {
            if (!rule.value) return true;
            const d = Date.parse(raw); const rv = Date.parse(rule.value);
            return !isNaN(d) && !isNaN(rv) && d < rv;
          }
          case "after": {
            if (!rule.value) return true;
            const d = Date.parse(raw); const rv = Date.parse(rule.value);
            return !isNaN(d) && !isNaN(rv) && d > rv;
          }
          default: return true;
        }
      });
    });
  }, [contactList, filterRules, contactSearch]);

  const sortedContactList = useMemo(() => {
    if (!sortCol) return filteredContactList;
    const values = filteredContactList.map(c => getContactField(c, sortCol));
    const type = detectSortType(values);
    return [...filteredContactList].sort((a, b) => {
      const av = getContactField(a, sortCol);
      const bv = getContactField(b, sortCol);
      let cmp = 0;
      if (type === "date") {
        const ad = av ? Date.parse(av) : 0;
        const bd = bv ? Date.parse(bv) : 0;
        cmp = ad - bd;
      } else if (type === "number") {
        cmp = parseFloat(av.replace(/,/g, "") || "0") - parseFloat(bv.replace(/,/g, "") || "0");
      } else {
        cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      }
      // Empty values always last
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredContactList, sortCol, sortDir]);

  // Traditional pagination for the list view — client-side over the already
  // filtered/sorted set, so filters/search/sort/column toggles and the counter
  // strip are all untouched. Kanban keeps its own (full-list) rendering.
  const [contactPageSize, setContactPageSizeState] = useState<number>(() => {
    const stored = Number(localStorage.getItem("loop_contactPageSize"));
    return [20, 50, 100].includes(stored) ? stored : 20;
  });
  const setContactPageSize = (n: number) => {
    setContactPageSizeState(n);
    localStorage.setItem("loop_contactPageSize", String(n));
  };
  const [contactPage, setContactPage] = useState(1);
  const contactPageCount = Math.max(1, Math.ceil(sortedContactList.length / contactPageSize));
  const safeContactPage = Math.min(contactPage, contactPageCount);
  // Reset to the first page whenever the result set or page size changes.
  useEffect(() => {
    setContactPage(1);
  }, [contactSearch, filterRules, contactPageSize, contactDateFrom, contactDateTo, contactTagFilters]);
  const pagedContactList = useMemo(
    () => sortedContactList.slice((safeContactPage - 1) * contactPageSize, (safeContactPage - 1) * contactPageSize + contactPageSize),
    [sortedContactList, safeContactPage, contactPageSize],
  );

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const bulkDeleteMutation = trpc.contacts.bulkDelete.useMutation({
    onSuccess: (res) => {
      toast.success(`Deleted ${res.deleted} contact${res.deleted !== 1 ? "s" : ""}`);
      setSelectedContactIds(new Set());
      void refetchContacts();
    },
    onError: (e) => toast.error(e.message),
  });
  const bulkAddTagMutation = trpc.contacts.bulkAddTag.useMutation({
    onSuccess: () => {
      toast.success("Tag added to selected contacts");
      setBulkTagDialogOpen(false);
      setBulkTagId("none");
      setSelectedContactIds(new Set());
      void refetchContacts();
    },
    onError: (e) => toast.error(e.message),
  });
  const bulkRemoveTagMutation = trpc.contacts.bulkRemoveTag.useMutation({
    onSuccess: () => {
      toast.success("Tag removed from selected contacts");
      setBulkRemoveTagDialogOpen(false);
      setSelectedContactIds(new Set());
      void refetchContacts();
    },
    onError: (e) => toast.error(e.message),
  });
  const setStatusMutation = trpc.contacts.setStatus.useMutation({
    onSuccess: () => void refetchContacts(),
    onError: (e) => toast.error(e.message),
  });
  const bulkSetStatusMutation = trpc.contacts.bulkSetStatus.useMutation({
    onSuccess: () => {
      toast.success("Status updated for selected contacts");
      setBulkStatusDialogOpen(false);
      setSelectedContactIds(new Set());
      void refetchContacts();
    },
    onError: (e) => toast.error(e.message),
  });
  // SmartLists
  const [activeSmartlistId, setActiveSmartlistId] = useState<number | null>(null);
  const [saveSmartlistName, setSaveSmartlistName] = useState("");
  const [showSaveSmartlist, setShowSaveSmartlist] = useState(false);
  const { data: smartlistsData = [], refetch: refetchSmartlists } = trpc.smartlists.list.useQuery(undefined, { staleTime: 30_000 });
  const createSmartlistMutation = trpc.smartlists.create.useMutation({
    onSuccess: (sl) => {
      toast.success(`SmartList "${sl.name}" saved`);
      setShowSaveSmartlist(false);
      setSaveSmartlistName("");
      setActiveSmartlistId(sl.id);
      void refetchSmartlists();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteSmartlistMutation = trpc.smartlists.delete.useMutation({
    onSuccess: () => {
      void refetchSmartlists();
      setActiveSmartlistId(null);
      setDeleteConfirmId(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const shareSmartlistMutation = trpc.smartlists.share.useMutation({
    onSuccess: () => { void refetchSmartlists(); toast.success('SmartList sharing updated'); setShareDialogId(null); },
    onError: (e) => toast.error(e.message),
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [shareDialogId, setShareDialogId] = useState<number | null>(null);
  const [shareMode, setShareMode] = useState<'public' | 'specific'>('public');
  const [shareUserIds, setShareUserIds] = useState<number[]>([]);
  const { data: allUsersForShare = [] } = trpc.admin.listUsers.useQuery(undefined, { staleTime: 60_000 });
  const { data: savedContact, refetch: refetchSavedContact } = trpc.contacts.getByPhone.useQuery(
    { phone: activeContact?.phone ?? "" },
    { enabled: !!activeContact?.phone, staleTime: 10_000 }
  );
  // Tags for the currently viewed contact
  const { data: savedContactTags = [], refetch: refetchSavedContactTags } = trpc.contacts.getTagsForContact.useQuery(
    { contactId: savedContact?.id ?? 0 },
    { enabled: !!savedContact?.id, staleTime: 10_000 }
  );

  const upsertContactMutation = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      setContactDialogOpen(false);
      void refetchContacts();
      void refetchSavedContact();
      void refetchSavedContactTags();
      toast.success("Contact saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const dispositionMutation = trpc.leads.setDisposition.useMutation();
  const notesMutation       = trpc.leads.setNotes.useMutation();
  const logCallMutation     = trpc.leads.logCall.useMutation();
  const utils               = trpc.useUtils();

  // Email send mutation
  const emailSendMutation = trpc.email.send.useMutation({
    onSuccess: () => {
      setEmailSubject('');
      setEmailBody('');
      toast.success('Email sent!');
      void utils.email.list.invalidate();
    },
    onError: (e) => toast.error(`Email failed: ${e.message}`),
  });

  // Contacts AI chat mutation (multi-turn, tool-calling)
  const contactsAIChatMutation = trpc.contacts.aiChat.useMutation();

  // Email AI mutation
  const emailAiMutation = trpc.conversations.generateMessage.useMutation({
    onSuccess: (data) => { setEmailBody(data.text); setEmailAiOpen(false); setEmailAiPrompt(''); },
    onError: (e) => toast.error('AI error: ' + e.message),
  });

  // Auto-restore latest session from DB if localStorage is empty
  const latestSessionQuery = trpc.leads.getLatestSession.useQuery(undefined, {
    enabled: !sessionId, // only fetch when we don't already have one
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!sessionId && latestSessionQuery.data?.sessionId) {
      const sid = latestSessionQuery.data.sessionId;
      setSessionId(sid);
      localStorage.setItem("loop_sessionId", sid);
      if (latestSessionQuery.data.tagId) {
        setSessionTagId(latestSessionQuery.data.tagId);
        localStorage.setItem("loop_sessionTagId", String(latestSessionQuery.data.tagId));
      }
    }
  }, [sessionId, latestSessionQuery.data]);

  const leadsQuery = trpc.leads.list.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: !!sessionId, refetchInterval: false }
  );
  const leads         = leadsQuery.data ?? [];
  // Tag filter: if any tags are selected and the session's tag doesn't match, hide all leads
  const sessionTagMatchesFilter = contactTagFilters.length === 0 || (sessionTagId !== null && contactTagFilters.includes(sessionTagId));
  const filteredLeads = sessionTagMatchesFilter ? leads.filter((l) => {
    if (search) {
      const q = search.toLowerCase();
      if (!l.name?.toLowerCase().includes(q) && !l.phone.toLowerCase().includes(q) && !l.company?.toLowerCase().includes(q)) return false;
    }
    return true;
  }) : [];
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  // Active phones (contacts with at least one call or SMS) — for Conversations panel
  const activePhonesQuery = trpc.contacts.getActivePhones.useQuery(undefined, {
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const convSummaryQuery = trpc.contacts.getConversationSummaries.useQuery(undefined, {
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
  const convSummaries = convSummaryQuery.data ?? [];
  const activePhoneSet = useMemo(() => new Set(activePhonesQuery.data ?? []), [activePhonesQuery.data]);
  // Contacts with activity — filtered by active phone set + tag filter
  const activeContacts = useMemo(() => {
    let list = contactList.filter(c => activePhoneSet.has(c.phone));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [contactList, activePhoneSet, search]);
  // Global call history for left panel
  const allCallHistoryQuery = trpc.leads.getAllCallHistory.useQuery(undefined, {
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const allCalls = allCallHistoryQuery.data ?? [];

  // Per-contact call history for conversation window
  const contactHistoryQuery = trpc.leads.getCallHistoryByPhone.useQuery(
    { phone: activeContact?.phone ?? "" },
    { enabled: !!activeContact, staleTime: 10_000 }
  );
  const contactCalls = contactHistoryQuery.data ?? [];

  // DB-backed SMS thread — polls every 5s for inbound replies
  const smsThreadQuery = trpc.telnyx.getSmsThread.useQuery(
    { phone: activeContact?.phone ?? "" },
    {
      enabled:         !!activeContact,
      refetchInterval: 5_000,
      staleTime:       4_000,
    }
  );
  const dbMessages = smsThreadQuery.data ?? [];

  // Email thread — polls every 30s for inbound replies (requires contact email)
  const contactEmail = savedContact?.email ?? '';
  const emailThreadQuery = trpc.email.list.useQuery(
    { email: contactEmail },
    { enabled: !!contactEmail, refetchInterval: 30_000, staleTime: 25_000 }
  );
  const emailMessages = emailThreadQuery.data ?? [];

  // Filtered contacts by tag
  const filteredContacts = useMemo(() => {
    if (contactTagFilter === null) return contactList;
    // We need per-contact tag data — for now filter by checking contactList
    // We'll use a simple approach: show all and let the tag badge indicate
    return contactList;
  }, [contactList, contactTagFilter]);

  // Sync notes when switching leads
  useEffect(() => {
    if (selectedLead) {
      setNotesValue(notesMap[selectedLead.id] ?? selectedLead.notes ?? "");
    }
  }, [selectedLeadId]);

  // Keep refs in sync with state
  useEffect(() => { activeContactRef.current = activeContact; }, [activeContact]);
  useEffect(() => { dispositionMapRef.current = dispositionMap; }, [dispositionMap]);

  // Live call timer
  const callElapsed = useCallTimer(phone.phoneState === "active");

  // Track call start / log on end
  useEffect(() => {
    if (phone.phoneState === "active") {
      callStartRef.current = Date.now();
      callStartedContactRef.current = activeContactRef.current;
      toast.success("Call connected — speak now");
    }
    if ((phone.phoneState === "ended" || phone.phoneState === "ready") && callStartRef.current !== null) {
      const duration = Math.floor((Date.now() - callStartRef.current) / 1000);
      const contact  = callStartedContactRef.current;
      callStartRef.current = null;
      callStartedContactRef.current = null;
      if (contact) {
        const disp = contact.leadId ? (dispositionMapRef.current[contact.leadId] ?? "none") : "none";
        logCallMutation.mutate(
          {
            leadId:          contact.leadId,
            sessionId:       contact.sessionId,
            phone:           contact.phone,
            contactName:     contact.name || undefined,
            direction:       "outbound",
            durationSeconds: duration,
            disposition:     disp as Disposition,
            startedAt:       Date.now() - duration * 1000,
          },
          {
            onSuccess: () => {
              utils.leads.getAllCallHistory.invalidate();
              utils.leads.getCallHistoryByPhone.invalidate({ phone: contact.phone });
              if (contact.leadId && contact.sessionId) {
                utils.leads.list.invalidate({ sessionId: contact.sessionId });
              }
            },
            onError: (err) => {
              console.error("[logCall] failed:", err);
              toast.error("Failed to save call record");
            },
          }
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone.phoneState]);

  // ─── Activate a CSV lead ──────────────────────────────────────────────────

  const handleSelectLead = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setActiveContact({
      phone: lead.phone,
      name: lead.name ?? "",
      leadId: lead.id,
      sessionId: sessionId ?? undefined,
    });
    setNotesValue(notesMap[lead.id] ?? lead.notes ?? "");
  };

  // ─── Open contact from global call history ────────────────────────────────

  const openContactFromHistory = (record: CallHistoryRecord) => {
    const matchingLead = leads.find((l) => l.phone === record.phone);
    if (matchingLead) {
      handleSelectLead(matchingLead);
    } else {
      setSelectedLeadId(null);
      setActiveContact({
        phone: record.phone,
        name: record.contactName ?? "",
      });
    }
  };

  // ─── CSV Upload — step 1: parse and show mapping modal ───────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) { toast.error("Please upload a CSV file"); return; }
    const text = await file.text();
    const { headers, rows } = parseCSV(text);
    if (rows.length === 0) { toast.error("CSV file is empty or invalid"); return; }
    // Show mapping modal
    setCsvPending({ file, headers, rows });
  }, []);

  // ─── CSV Upload — step 2: apply mapping and import ───────────────────────

  const handleCsvImport = useCallback(async (
    mapping: Record<string, ContactFieldKey>,
    tagId: number,
  ) => {
    if (!csvPending) return;
    const { file, rows } = csvPending;

    const normalizedRows = rows.map((rawRow) => {
      const mapped: Record<string, string> = {};
      Object.entries(mapping).forEach(([csvCol, field]) => {
        if (field !== "skip") {
          mapped[field] = rawRow[csvCol] ?? "";
        }
      });
      return mapped;
    });

    const KNOWN_FIELDS = ["phone", "name", "company", "email", "source", "criteria1", "criteria2", "criteria3", "criteria4", "criteria5", "closer", "priceQuoted", "callRecordingUrl", "objections", "dealResult", "status", "tags", "createdAt"];
    // Normalize phones to E.164 (AU default); rows that can't be normalized are skipped.
    const rowsWithPhone = normalizedRows.map((r) => ({ row: r, phone: normalizeAuPhone(r.phone) }));
    const skippedCount = rowsWithPhone.filter((x) => x.phone === null).length;
    const leadRows = rowsWithPhone
      .filter((x): x is { row: Record<string, string>; phone: string } => x.phone !== null)
      .map(({ row: r, phone }) => ({
        phone:     phone,
        name:      r.name?.trim()      || undefined,
        company:   r.company?.trim()   || undefined,
        email:     r.email?.trim()     || undefined,
        source:    r.source?.trim()    || undefined,
        criteria1: r.criteria1?.trim() || undefined,
        criteria2: r.criteria2?.trim() || undefined,
        criteria3: r.criteria3?.trim() || undefined,
        criteria4: r.criteria4?.trim() || undefined,
        criteria5: r.criteria5?.trim() || undefined,
        closer:           r.closer?.trim()           || undefined,
        priceQuoted:      r.priceQuoted?.trim()      || undefined,
        callRecordingUrl: r.callRecordingUrl?.trim() || undefined,
        objections:       r.objections?.trim()       || undefined,
        dealResult:       r.dealResult?.trim()       || undefined,
        status:    resolveStatusValue(r.status),
        tags:      (r.tags ?? "").split(",").map(t => t.trim()).filter(Boolean),
        createdAt: r.createdAt?.trim() || undefined,
        extraData: Object.fromEntries(
          Object.entries(r).filter(([k]) => !KNOWN_FIELDS.includes(k))
        ),
      }));

    if (leadRows.length === 0) {
      toast.error(skippedCount > 0 ? `No valid phone numbers — ${skippedCount} row${skippedCount !== 1 ? "s" : ""} skipped (invalid phone)` : "No valid phone numbers found after mapping");
      return;
    }

    try {
      const result = await uploadMutation.mutateAsync({
        fileName: file.name,
        tagId:    tagId ?? undefined,
        rows:     leadRows,
      });
      setSessionId(result.sessionId);
      localStorage.setItem("loop_sessionId", result.sessionId);
      setSessionTagId(tagId);
      localStorage.setItem("loop_sessionTagId", String(tagId));
      setSelectedLeadId(null);
      setCsvPending(null);
      const skippedNote = skippedCount > 0 ? ` (${skippedCount} skipped — invalid phone)` : "";
      toast.success(`Imported ${result.imported ?? leadRows.length} contact${(result.imported ?? leadRows.length) !== 1 ? "s" : ""} from ${file.name}${skippedNote}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${msg.slice(0, 120)}`);
      console.error("[Upload] Failed:", err);
    }
  }, [csvPending, uploadMutation]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ─── Read tracking ────────────────────────────────────────────────────────

  const [readTimes, setReadTimes] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("loop_conv_read") ?? "{}") as Record<string, number>; }
    catch { return {}; }
  });

  const markRead = useCallback((phone: string) => {
    setReadTimes(prev => {
      const next = { ...prev, [phone]: Date.now() };
      localStorage.setItem("loop_conv_read", JSON.stringify(next));
      return next;
    });
  }, []);

  const unreadPhones = useMemo(() => {
    const set = new Set<string>();
    for (const s of convSummaries) {
      if (!s.lastInboundAt) continue;
      const lastRead = readTimes[s.phone] ?? 0;
      if (new Date(s.lastInboundAt).getTime() > lastRead) {
        set.add(s.phone);
      }
    }
    return set;
  }, [convSummaries, readTimes]);

  // ─── Call ─────────────────────────────────────────────────────────────────

  const handleCall = () => {
    if (!activeContact) { toast.error("Select a contact first"); return; }
    const isActive = ["connecting", "ringing", "active", "reconnecting"].includes(phone.phoneState);
    if (isActive) {
      if (phone.conferenceToken) { phone.endConference().catch(() => {}); }
      else { phone.hangup(); }
      return;
    }
    if (phone.phoneState !== "ready") { toast.error("Connect your microphone first"); return; }
    // Every call starts as a conference so 3-way is always available without re-dialling.
    phone.startConference(activeContact.phone).catch((e: unknown) => {
      toast.error(`Call failed: ${e instanceof Error ? e.message : "error"}`);
    });
    toast.success(`Calling ${activeContact.name || activeContact.phone}…`);
  };

  // ─── SMS / iMessage ──────────────────────────────────────────────────────
  const handleSMS = async (text: string) => {
    if (!activeContact) return;
    const key = activeContact.phone;
    const tempId = `msg-${Date.now()}`;
    const useIMessage = iMessageMode;
    const newMsg: ChatMessage = {
      id: tempId, direction: "outbound", text, timestamp: new Date(),
      status: "sending", channel: useIMessage ? "imessage" : "sms",
    };
    setPendingMessages((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), newMsg] }));
    try {
      if (useIMessage) {
        await blooioMutation.mutateAsync({ to: activeContact.phone, text });
      } else {
        await smsMutation.mutateAsync({ to: activeContact.phone, text });
      }
      setPendingMessages((prev) => ({
        ...prev,
        [key]: (prev[key] ?? []).filter((m) => m.id !== tempId),
      }));
      utils.telnyx.getSmsThread.invalidate({ phone: activeContact.phone });
    } catch (e: unknown) {
      setPendingMessages((prev) => ({
        ...prev,
        [key]: (prev[key] ?? []).map((m) => m.id === tempId ? { ...m, status: "failed" } : m),
      }));
      toast.error((e as Error).message ?? "Send failed");
    }
  };

  // ─── Disposition ──────────────────────────────────────────────────────────

  const handleDisposition = async (d: Disposition) => {
    if (!activeContact?.leadId) return;
    const id = activeContact.leadId;
    setDispositionMap((prev) => ({ ...prev, [id]: d }));
    utils.leads.list.setData({ sessionId: sessionId! }, (old) =>
      old?.map((l) => l.id === id ? { ...l, disposition: d } : l)
    );
    try {
      await dispositionMutation.mutateAsync({ id, disposition: d });
    } catch {
      toast.error("Failed to update disposition");
    }
  };

  // ─── Notes ────────────────────────────────────────────────────────────────

  const handleNotesChange = (value: string) => {
    setNotesValue(value);
    if (!activeContact?.leadId) return;
    const id = activeContact.leadId;
    setNotesMap((prev) => ({ ...prev, [id]: value }));
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      try {
        await notesMutation.mutateAsync({ id, notes: value });
        utils.leads.list.setData({ sessionId: sessionId! }, (old) =>
          old?.map((l) => l.id === id ? { ...l, notes: value } : l)
        );
      } catch { /* silent */ }
    }, 800);
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const callIsActive = ["connecting", "ringing", "active", "reconnecting"].includes(phone.phoneState);
  const currentDisposition: Disposition = (
    activeContact?.leadId ? dispositionMap[activeContact.leadId] ?? selectedLead?.disposition : "none"
  ) as Disposition ?? "none";

  // Build unified timeline
  const timelineEvents = useMemo((): TimelineEvent[] => {
    const callEvents: TimelineEvent[] = contactCalls.map((r) => ({ kind: "call" as const, record: r }));
    const dbSmsEvents: TimelineEvent[] = dbMessages.map((m) => ({
      kind: "sms" as const,
      msg: {
        id:        String(m.id),
        direction: m.direction as "outbound" | "inbound",
        text:      m.body,
        timestamp: new Date(m.createdAt),
        status:    m.status as "sent" | "failed" | "sending",
      },
    }));
    const pendingSmsEvents: TimelineEvent[] = (activeContact ? (pendingMessages[activeContact.phone] ?? []) : [])
      .map((msg) => ({ kind: "sms" as const, msg }));

    return [...callEvents, ...dbSmsEvents, ...pendingSmsEvents].sort((a, b) => {
      const ta = a.kind === "call" ? new Date(a.record.startedAt).getTime() : a.msg.timestamp.getTime();
      const tb = b.kind === "call" ? new Date(b.record.startedAt).getTime() : b.msg.timestamp.getTime();
      return ta - tb;
    });
  }, [contactCalls, dbMessages, pendingMessages, activeContact]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border/60 shrink-0 bg-background/80 backdrop-blur-xl" style={{boxShadow:'0 1px 0 oklch(1 0 0 / 0.04), 0 4px 24px -8px oklch(0.62 0.22 258 / 0.18)'}}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center" style={{boxShadow:'0 0 22px 4px oklch(0.62 0.22 258 / 0.55), 0 0 8px 2px oklch(0.62 0.22 258 / 0.35)'}}>
            <PhoneCall size={22} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight olivia-title">OliviaAI</h1>
            <p className="text-[10px] text-muted-foreground/70 tracking-wide uppercase">Outbound Sales</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PhoneStatusPill
            phoneState={phone.phoneState}
            isMuted={phone.isMuted}
            error={phone.error}
            callElapsed={callElapsed}
            onInit={phone.initialize}
            onHangup={phone.hangup}
            onToggleMute={phone.toggleMute}
          />
          <WhatsNewMenu />
          <Button variant="outline" size="icon" onClick={toggleTheme}
            className="w-8 h-8 border-border text-muted-foreground hover:text-foreground"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ICON SIDEBAR */}
        <nav className="w-14 shrink-0 border-r border-border/50 flex flex-col items-center py-3 gap-1 bg-background/50 backdrop-blur-sm">
          <button
            onClick={() => setLeftTabPersist("conversations")}
            title="Conversations"
            className={`relative w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${leftTab === "conversations" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"}`}
            style={leftTab === "conversations" ? {boxShadow:'0 0 14px 2px oklch(0.62 0.22 258 / 0.30)'} : {}}
          >
            <MessageSquare size={18} />
            {allCalls.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1" style={{boxShadow:'0 0 8px 1px oklch(0.55 0.22 25 / 0.60)'}}>
                {allCalls.length > 99 ? "99+" : allCalls.length}
              </span>
            )}
            <span className="text-[8px] font-medium leading-none">Convos</span>
          </button>
          <button
            onClick={() => setLeftTabPersist("contacts")}
            title="Contacts"
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${leftTab === "contacts" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"}`}
            style={leftTab === "contacts" ? {boxShadow:'0 0 14px 2px oklch(0.62 0.22 258 / 0.30)'} : {}}
          >
            <Users size={18} />
            <span className="text-[8px] font-medium leading-none">Contacts</span>
          </button>
          <button
            onClick={() => setLeftTabPersist("settings")}
            title="Settings"
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${leftTab === "settings" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"}`}
            style={leftTab === "settings" ? {boxShadow:'0 0 14px 2px oklch(0.62 0.22 258 / 0.30)'} : {}}
          >
            <Settings size={18} />
            <span className="text-[8px] font-medium leading-none">Settings</span>
          </button>
          <button
            onClick={() => setLeftTabPersist("automations")}
            title="Automations"
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${leftTab === "automations" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"}`}
            style={leftTab === "automations" ? {boxShadow:'0 0 14px 2px oklch(0.62 0.22 258 / 0.30)'} : {}}
          >
            <Zap size={18} />
            <span className="text-[8px] font-medium leading-none">Flows</span>
          </button>
          <button
            onClick={() => setLeftTabPersist("appointments")}
            title="Appointments"
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${leftTab === "appointments" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"}`}
            style={leftTab === "appointments" ? {boxShadow:'0 0 14px 2px oklch(0.62 0.22 258 / 0.30)'} : {}}
          >
            <CalendarDays size={18} />
            <span className="text-[8px] font-medium leading-none">Appts</span>
          </button>
          <button
            onClick={() => setLeftTabPersist("power")}
            title="Power Dialler"
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${leftTab === "power" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/6 hover:text-foreground"}`}
            style={leftTab === "power" ? {boxShadow:'0 0 14px 2px oklch(0.62 0.22 258 / 0.30)'} : {}}
          >
            <Phone size={18} />
            <span className="text-[8px] font-medium leading-none">Power</span>
          </button>
        </nav>

         {/* ── FULL-WIDTH CONTACTS TABLE (replaces aside+main when contacts tab active) ── */}
        {leftTab === "contacts" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between gap-3 bg-background/70 backdrop-blur-sm">
              <div>
                <p className="text-base font-semibold gradient-text">Contacts</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sortedContactList.length !== contactList.length
                    ? `${sortedContactList.length} of ${contactList.length} contacts`
                    : `${contactList.length} contact${contactList.length !== 1 ? "s" : ""}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search contacts…"
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                    className="h-9 pl-8 pr-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-44"
                  />
                </div>
                {/* Add Contact */}
                <button
                  onClick={() => {
                    setContactForm({ phone: "", name: "", email: "", company: "", notes: "", source: "", criteria1: "", criteria2: "", criteria3: "", criteria4: "", criteria5: "", tagIds: [], status: "", outcome: "", timezone: "", closer: "", priceQuoted: "", callRecordingUrl: "", objections: "", dealResult: "" });
                    setContactDialogOpen(true);
                  }}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 transition-all"
                >
                  <UserPlus size={13} />
                  Add Contact
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-all"
                >
                  <Upload size={13} />
                  Upload
                </button>
                <button
                  onClick={() => setShowContactFilters(v => !v)}
                  className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-all ${
                    showContactFilters || filterRules.length > 0
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  }`}
                >
                  <Filter size={13} />
                  Filters
                  {filterRules.length > 0 && (
                    <span className="ml-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                      {filterRules.length}
                    </span>
                  )}
                </button>
                {/* Ask AI button */}
                <button
                  onClick={() => setShowContactsAI(v => !v)}
                  className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-all ${
                    showContactsAI
                      ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  }`}
                >
                  <Sparkles size={13} />
                  Ask AI
                </button>
                {/* Column visibility (list view only) */}
                {contactsViewMode === "list" && (
                  <Popover open={columnMenuOpen} onOpenChange={setColumnMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        title="Choose columns"
                        className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-all"
                      >
                        <Columns3 size={13} />
                        Columns
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-1.5 max-h-[420px] overflow-y-auto" align="end">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1.5">Visible Columns</p>
                      {CONTACT_COLUMNS.map(({ col, label }) => {
                        const checked = visibleColumnSet.has(col);
                        const pinned = ALWAYS_ON_COLUMNS.includes(col);
                        return (
                          <button
                            key={col}
                            onClick={() => toggleColumn(col)}
                            disabled={pinned}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left transition-colors ${pinned ? "cursor-default opacity-70" : "hover:bg-accent"}`}
                          >
                            <Checkbox checked={checked} disabled={pinned} className="w-3.5 h-3.5 pointer-events-none" />
                            <span className="truncate">{label}</span>
                            {pinned && <span className="ml-auto text-[9px] text-muted-foreground uppercase tracking-wide">Pinned</span>}
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                )}
                {/* View toggle */}
                <div className="flex items-center rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setContactsView("list")}
                    title="List view"
                    className={`flex items-center justify-center w-9 h-9 transition-all ${
                      contactsViewMode === "list"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <ListIcon size={14} />
                  </button>
                  <button
                    onClick={() => setContactsView("kanban")}
                    title="Kanban view"
                    className={`flex items-center justify-center w-9 h-9 border-l border-border transition-all ${
                      contactsViewMode === "kanban"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <LayoutGrid size={14} />
                  </button>
                </div>
              </div>
            </div>
            {/* ── Pipeline counters — true totals over ALL contacts (not the capped list) ── */}
            {(() => {
              // Prefer the server-side aggregate; fall back to the loaded list until it arrives.
              const st = (s: string) => contactStats ? (contactStats.byStatus[s] ?? 0) : contactList.reduce((n, c) => n + ((c as any).status === s ? 1 : 0), 0);
              const dr = (d: string) => contactStats ? (contactStats.byDealResult[d] ?? 0) : contactList.reduce((n, c) => n + ((c as any).dealResult === d ? 1 : 0), 0);
              const counters = [
                { label: "TOTAL",      value: contactStats ? contactStats.total : contactList.length, accent: "#a78bfa" },
                { label: "SHOWS",      value: st("show"),         accent: "#4ade80" },
                { label: "NO SHOW",    value: st("no_show"),      accent: "#f87171" },
                { label: "UPCOMING",   value: st("upcoming"),     accent: "#38bdf8" },
                { label: "NOT BOOKED", value: st("not_booked"),   accent: "#94a3b8" },
                { label: "WON",        value: dr("won"),          accent: "#22c55e" },
                { label: "LOST",       value: dr("lost"),         accent: "#ef4444" },
                { label: "PENDING",    value: dr("pending"),      accent: "#f59e0b" },
              ];
              return (
                <div className="flex items-stretch gap-2 overflow-x-auto px-6 py-3 border-b border-border shrink-0 bg-background/40">
                  {counters.map(c => (
                    <div
                      key={c.label}
                      className="flex flex-col items-center justify-center min-w-[84px] px-3 py-1.5 rounded-lg border border-border/60 bg-card/40"
                      style={{ boxShadow: `inset 0 -2px 0 ${c.accent}55` }}
                    >
                      <span className="text-lg font-bold leading-none" style={{ color: c.accent }}>{c.value}</span>
                      <span className="text-[9px] font-semibold tracking-wide text-muted-foreground mt-1">{c.label}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* AI chat panel — slide in below header when showContactsAI is true */}
            {showContactsAI && (
              <div className="border-b border-border bg-muted/10 px-6 py-4 shrink-0">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={14} className="text-purple-400" />
                  <span className="text-sm font-medium text-foreground">Contacts AI</span>
                  <span className="text-xs text-muted-foreground">Add, edit, search contacts and manage tags using plain language</span>
                </div>
                <AIChatBox
                  messages={contactsAIMessages}
                  isLoading={isContactsAILoading}
                  placeholder="e.g. Add John Smith +61412345678 or update Travis's timezone to Australia/Sydney…"
                  height={360}
                  emptyStateMessage="I can add contacts, edit their fields, manage tags, update statuses, and search your contact list — just ask."
                  suggestedPrompts={[
                    "Add Sarah Jones, +61400123456, sarah@company.com, from Melbourne",
                    "Find Travis and add the 'Hot Lead' tag to him",
                    "Update Prasad's timezone to Australia/Adelaide and status to Interested",
                    "Show me all contacts at Acme Corp",
                  ]}
                  onSendMessage={async (content) => {
                    const newMessages = [...contactsAIMessages, { role: "user" as const, content }];
                    setContactsAIMessages(newMessages);
                    setIsContactsAILoading(true);
                    try {
                      const apiMessages = newMessages
                        .filter(m => m.role === "user" || m.role === "assistant")
                        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
                      const result = await contactsAIChatMutation.mutateAsync({ messages: apiMessages });
                      setContactsAIMessages(prev => [...prev, { role: "assistant" as const, content: result.reply }]);
                      void refetchContacts();
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : "Unknown error";
                      setContactsAIMessages(prev => [...prev, { role: "assistant" as const, content: `❌ Error: ${msg}` }]);
                    } finally {
                      setIsContactsAILoading(false);
                    }
                  }}
                />
              </div>
            )}
            {/* Tag permission notice for restricted users */}
            {currentUser && currentUser.role !== 'admin' && myPermittedTagIds !== undefined && (
              <div className={`px-6 py-2 shrink-0 flex items-center gap-2 text-xs border-b border-border ${
                myPermittedTagIds === null || myPermittedTagIds.length > 0
                  ? 'bg-blue-500/5 text-blue-600 dark:text-blue-400'
                  : 'bg-red-500/5 text-red-600 dark:text-red-400'
              }`}>
                <Tag size={11} className="shrink-0" />
                {myPermittedTagIds === null
                  ? 'Showing all contacts (full access)'
                  : myPermittedTagIds.length === 0
                  ? 'No tag permissions assigned — contact your admin to gain access'
                  : `Showing contacts tagged: ${allTags.filter(t => myPermittedTagIds.includes(t.id)).map(t => t.name).join(', ')}`
                }
              </div>
            )}
            {/* Notion-style filter builder */}
            {showContactFilters && (
              <div className="px-6 py-3 border-b border-border shrink-0 bg-muted/20">
                {filterRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">No filters applied — add a rule to filter contacts</p>
                ) : (
                  <div className="flex flex-col gap-2 mb-2">
                    {filterRules.map((rule, idx) => {
                      const isTagField    = rule.field === "tags";
                      const isDateField   = rule.field === "createdAt";
                      const isStatusField = rule.field === "status";
                      const isDealResultField = rule.field === "dealResult";
                      const needsValue = !["is_empty","is_not_empty"].includes(rule.operator);
                      const FIELD_OPTS = [
                        { v: "name",      l: "Name" },
                        { v: "phone",     l: "Phone" },
                        { v: "email",     l: "Email" },
                        { v: "company",   l: "Company" },
                        { v: "status",    l: "Status" },
                        { v: "source",    l: "Source" },
                        { v: "criteria1", l: "Criteria 1" },
                        { v: "criteria2", l: "Criteria 2" },
                        { v: "criteria3", l: "Criteria 3" },
                        { v: "criteria4", l: "Criteria 4" },
                        { v: "criteria5", l: "Criteria 5" },
                        { v: "closer",           l: "Closer" },
                        { v: "priceQuoted",      l: "Price Quoted" },
                        { v: "callRecordingUrl", l: "Call Recording URL" },
                        { v: "objections",       l: "Objections" },
                        { v: "dealResult",       l: "Deal Result" },
                        { v: "tags",      l: "Tag" },
                        { v: "createdAt", l: "Date Created" },
                        { v: "outcome", l: "Notes / Outcome" },
                      ];
                      const TEXT_OPS = [
                        { v: "contains",     l: "contains" },
                        { v: "not_contains", l: "does not contain" },
                        { v: "is",           l: "is" },
                        { v: "is_not",       l: "is not" },
                        { v: "is_empty",     l: "is empty" },
                        { v: "is_not_empty", l: "is not empty" },
                      ];
                      const DATE_OPS = [
                        { v: "before",       l: "before" },
                        { v: "after",        l: "after" },
                        { v: "is_empty",     l: "is empty" },
                        { v: "is_not_empty", l: "is not empty" },
                      ];
                      const TAG_OPS = [
                        { v: "has_tag",      l: "has tag" },
                        { v: "no_tag",       l: "does not have tag" },
                        { v: "is_empty",     l: "has no tags" },
                        { v: "is_not_empty", l: "has any tag" },
                      ];
                      const STATUS_OPS = [
                        { v: "is",           l: "is" },
                        { v: "is_not",       l: "is not" },
                        { v: "is_empty",     l: "is empty (no status)" },
                        { v: "is_not_empty", l: "is not empty" },
                      ];
                      const ops = isTagField ? TAG_OPS : isDateField ? DATE_OPS : isStatusField ? STATUS_OPS : TEXT_OPS;
                      return (
                        <div key={rule.id} className="flex items-center gap-2 flex-wrap">
                          {idx > 0 && <span className="text-[10px] font-semibold text-muted-foreground uppercase w-8 text-right shrink-0">AND</span>}
                          {idx === 0 && <span className="text-[10px] font-semibold text-muted-foreground uppercase w-8 text-right shrink-0">WHERE</span>}
                          {/* Field selector */}
                          <Select value={rule.field} onValueChange={v => {
                            const defaultOp: FilterOperator = v === "tags" ? "has_tag" : v === "createdAt" ? "before" : (v === "status" || v === "dealResult") ? "is" : "contains";
                            setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, field: v, operator: defaultOp, value: "" } : r));
                          }}>
                            <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_OPTS.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {/* Operator selector */}
                          <Select value={rule.operator} onValueChange={v => setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, operator: v as FilterOperator, value: "" } : r))}>
                            <SelectTrigger size="sm" className="h-7 w-44 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ops.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {/* Value input */}
                          {needsValue && (
                            isStatusField ? (
                              <Select value={rule.value} onValueChange={v => setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, value: v } : r))}>
                                <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                                  <SelectValue placeholder="Select status…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {CONTACT_STATUSES.map(s => (
                                    <SelectItem key={s.value} value={s.value}>
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                        {s.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : isDealResultField ? (
                              <Select value={rule.value} onValueChange={v => setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, value: v } : r))}>
                                <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                                  <SelectValue placeholder="Select result…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {DEAL_RESULTS.map(d => (
                                    <SelectItem key={d.value} value={d.value}>
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.bg }} />
                                        {d.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : isTagField ? (
                              <Select value={rule.value} onValueChange={v => setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, value: v } : r))}>
                                <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                                  <SelectValue placeholder="Select tag…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {allTags.map(t => (
                                    <SelectItem key={t.id} value={String(t.id)}>
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                        {t.name}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : isDateField ? (
                              <Input type="date" value={rule.value} onChange={e => setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, value: e.target.value } : r))} className="h-7 text-xs w-36" />
                            ) : (
                              <Input
                                value={rule.value}
                                onChange={e => setFilterRules(prev => prev.map((r,i) => i===idx ? { ...r, value: e.target.value } : r))}
                                placeholder="Value…"
                                className="h-7 text-xs w-36"
                              />
                            )
                          )}
                          {/* Remove rule */}
                          <button
                            onClick={() => setFilterRules(prev => prev.filter((_,i) => i !== idx))}
                            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={() => setFilterRules(prev => [...prev, { id: Math.random().toString(36).slice(2), field: "name", operator: "contains", value: "" }])}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus size={12} /> Add filter
                  </button>
                  {filterRules.length > 0 && (
                    <button
                      onClick={() => setFilterRules([])}
                      className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors"
                    >
                      <X size={12} /> Clear all
                    </button>
                  )}
                  {filterRules.length > 0 && !showSaveSmartlist && (
                    <button
                      onClick={() => setShowSaveSmartlist(true)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors ml-auto"
                    >
                      <Plus size={12} /> Save as SmartList
                    </button>
                  )}
                  {showSaveSmartlist && (
                    <div className="flex items-center gap-2 ml-auto">
                      <input
                        autoFocus
                        type="text"
                        placeholder="SmartList name…"
                        value={saveSmartlistName}
                        onChange={e => setSaveSmartlistName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && saveSmartlistName.trim()) {
                            createSmartlistMutation.mutate({ name: saveSmartlistName.trim(), filterRules });
                          }
                          if (e.key === "Escape") { setShowSaveSmartlist(false); setSaveSmartlistName(""); }
                        }}
                        className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary w-40"
                      />
                      <button
                        disabled={!saveSmartlistName.trim() || createSmartlistMutation.isPending}
                        onClick={() => createSmartlistMutation.mutate({ name: saveSmartlistName.trim(), filterRules })}
                        className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Save
                      </button>
                      <button onClick={() => { setShowSaveSmartlist(false); setSaveSmartlistName(""); }} className="text-xs text-muted-foreground hover:text-foreground">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SmartList tabs */}
            {smartlistsData.length > 0 && (
              <div className="px-4 pt-2 pb-0 border-b border-border shrink-0 flex items-center gap-1 overflow-x-auto">
                <button
                  onClick={() => { setActiveSmartlistId(null); setFilterRules([]); }}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-t-md border-b-2 transition-all whitespace-nowrap ${
                    activeSmartlistId === null
                      ? "border-primary text-primary font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All Contacts
                </button>
                {smartlistsData.map(sl => (
                  <div key={sl.id} className={`group flex items-center gap-1 text-xs px-3 py-1.5 rounded-t-md border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                    activeSmartlistId === sl.id
                      ? "border-primary text-primary font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                    onClick={() => {
                      setActiveSmartlistId(sl.id);
                      const rules = (sl.filterRules as any[]).map((r: any) => ({ ...r, id: r.id ?? Math.random().toString(36).slice(2) }));
                      setFilterRules(rules);
                      setShowContactFilters(false);
                    }}
                  >
                    <span>{sl.name}</span>
                    {(sl as any).isPublic && <span title="Shared with all users"><Globe size={9} className="text-green-500 shrink-0" /></span>}
                    {!(sl as any).isPublic && (sl as any).sharedWith && <span title="Shared with specific users"><Users size={9} className="text-blue-500 shrink-0" /></span>}
                    <button
                      onClick={e => { e.stopPropagation(); setShareDialogId(sl.id); setShareMode((sl as any).isPublic ? 'public' : 'specific'); setShareUserIds((sl as any).sharedWith ? JSON.parse((sl as any).sharedWith) : []); }}
                      className="opacity-0 group-hover:opacity-100 ml-0.5 text-muted-foreground hover:text-primary transition-all"
                      title="Share"
                    >
                      <Share2 size={10} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirmId(sl.id); }}
                      className="opacity-0 group-hover:opacity-100 ml-0.5 text-muted-foreground hover:text-destructive transition-all"
                      title="Delete"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Bulk action toolbar */}
            {selectedContactIds.size > 0 && (
              <div className="px-6 py-2.5 border-b border-border shrink-0 flex items-center gap-3 bg-primary/5">
                <span className="text-sm font-medium text-primary">{selectedContactIds.size} selected</span>
                <div className="flex-1" />
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulkTagDialogOpen(true)}>
                  <Tag size={12} /> Add Tag
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulkRemoveTagDialogOpen(true)}>
                  <X size={12} /> Remove Tag
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulkStatusDialogOpen(true)}>
                  <CircleDot size={12} /> Set Status
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-8 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => {
                    if (!confirm(`Delete ${selectedContactIds.size} contact${selectedContactIds.size !== 1 ? "s" : ""}?`)) return;
                    bulkDeleteMutation.mutate({ ids: Array.from(selectedContactIds) });
                  }}
                  disabled={bulkDeleteMutation.isPending}
                >
                  {bulkDeleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  Delete
                </Button>
              </div>
            )}

            {/* Table / Kanban */}
            {contactList.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
                <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center">
                  <Users size={24} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">No contacts found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {(contactDateFrom || contactDateTo || contactTagFilters.length > 0)
                      ? "Try adjusting your filters"
                      : "Upload a CSV to import contacts"}
                  </p>
                </div>
              </div>
            ) : contactsViewMode === "kanban" ? (
              <ContactsKanban
                contacts={sortedContactList}
                onOpenConvo={(c) => { setActiveContact({ phone: c.phone, name: c.name ?? undefined, leadId: undefined }); setLeftTabPersist("conversations"); }}
                onStatusChange={(contactId, status) => setStatusMutation.mutate({ contactId, status })}  
              />
            ) : (
              <>
              <div className="flex-1 overflow-auto" style={{ minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
                <table className="w-full border-collapse" style={{ minWidth: '1600px' }}>
                  <thead className="sticky top-0 z-10" style={{ background: 'hsl(var(--background))' }}>
                     <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground" style={{ background: 'hsl(var(--background))' }}>
                      <th className="w-10 px-4 py-2.5 text-left font-semibold">
                        <Checkbox
                          checked={selectedContactIds.size === sortedContactList.length && sortedContactList.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) setSelectedContactIds(new Set(sortedContactList.map(c => c.id)));
                            else setSelectedContactIds(new Set());
                          }}
                          className="w-4 h-4"
                        />
                      </th>
                      {CONTACT_COLUMNS.filter(({ col }) => visibleColumnSet.has(col)).map(({ col, label, w }) => (
                        col === "tags" ? (
                          <th key={col} className={`${w} px-3 py-2.5 text-left font-semibold`}>Tags</th>
                        ) : (
                          <th key={col} className={`${w} px-3 py-2.5 text-left font-semibold`}>
                            <button
                              className={`flex items-center gap-1 hover:text-foreground transition-colors ${ sortCol === col ? "text-foreground" : "" }`}
                              onClick={() => handleSort(col)}
                            >
                              <span className="truncate">{label}</span>
                              {sortCol === col
                                ? (sortDir === "asc" ? <ChevronUp size={11} className="shrink-0" /> : <ChevronDown size={11} className="shrink-0" />)
                                : <ChevronsUpDown size={10} className="shrink-0 opacity-30" />}
                            </button>
                          </th>
                        )
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedContactList.map((c) => {
                      const isSelected = selectedContactIds.has(c.id);
                      return (
                        <ContactTableRow
                          key={c.id}
                          contact={c}
                          initialTags={(c as any).tags ?? []}
                          visibleColumns={visibleColumnSet}
                          selected={isSelected}
                          onToggle={() => {
                            setSelectedContactIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            });
                          }}
                          onClick={() => {
                            setActiveContact({ phone: c.phone, name: c.name ?? undefined, leadId: undefined });
                            setLeftTabPersist("conversations");
                          }}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* ── Pagination footer (list view) ── */}
              <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-2.5 border-t border-border bg-background/70">
                <div className="text-xs text-muted-foreground">
                  {sortedContactList.length === 0
                    ? "No contacts"
                    : `Showing ${((safeContactPage - 1) * contactPageSize + 1).toLocaleString()}–${Math.min(safeContactPage * contactPageSize, sortedContactList.length).toLocaleString()} of ${sortedContactList.length.toLocaleString()}`}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setContactPage(p => Math.max(1, p - 1))}
                    disabled={safeContactPage <= 1}
                    className="flex items-center gap-1 h-7 px-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:border-border/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft size={13} /> Prev
                  </button>
                  {(() => {
                    const total = contactPageCount;
                    const cur = safeContactPage;
                    const items: (number | "…")[] = [];
                    for (let p = 1; p <= total; p++) {
                      if (p === 1 || p === total || (p >= cur - 1 && p <= cur + 1)) items.push(p);
                      else if (items[items.length - 1] !== "…") items.push("…");
                    }
                    return items.map((it, i) =>
                      it === "…" ? (
                        <span key={`e${i}`} className="px-1.5 text-xs text-muted-foreground/50 select-none">…</span>
                      ) : (
                        <button
                          key={it}
                          onClick={() => setContactPage(it)}
                          className={`min-w-7 h-7 px-2 rounded-md text-xs font-medium border transition-all ${
                            it === cur
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                          }`}
                        >
                          {it}
                        </button>
                      ),
                    );
                  })()}
                  <button
                    onClick={() => setContactPage(p => Math.min(contactPageCount, p + 1))}
                    disabled={safeContactPage >= contactPageCount}
                    className="flex items-center gap-1 h-7 px-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:border-border/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Next <ChevronRight size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">Page {safeContactPage} of {contactPageCount}</span>
                  <Select value={String(contactPageSize)} onValueChange={(v) => setContactPageSize(Number(v))}>
                    <SelectTrigger size="sm" className="h-7 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[20, 50, 100].map(n => (
                        <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              </>
            )}

            {/* SmartList Delete Confirm Dialog */}
            <Dialog open={deleteConfirmId !== null} onOpenChange={(v) => { if (!v) setDeleteConfirmId(null); }}>
              <DialogContent className="sm:max-w-xs">
                <DialogHeader>
                  <DialogTitle>Delete SmartList?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground py-2">
                  Are you sure you want to delete <strong>{smartlistsData.find(s => s.id === deleteConfirmId)?.name}</strong>? This cannot be undone.
                </p>
                <DialogFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                  <Button
                    variant="destructive" size="sm"
                    disabled={deleteSmartlistMutation.isPending}
                    onClick={() => { if (deleteConfirmId !== null) deleteSmartlistMutation.mutate({ id: deleteConfirmId }); }}
                  >
                    {deleteSmartlistMutation.isPending ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
                    Delete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* SmartList Share Dialog */}
            <Dialog open={shareDialogId !== null} onOpenChange={(v) => { if (!v) setShareDialogId(null); }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><Share2 size={16} /> Share SmartList</DialogTitle>
                </DialogHeader>
                <div className="py-2 space-y-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShareMode('public')}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                        shareMode === 'public' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      <Globe size={14} className="inline mr-1.5" />Share with All Users
                    </button>
                    <button
                      onClick={() => setShareMode('specific')}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                        shareMode === 'specific' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      <Users size={14} className="inline mr-1.5" />Specific Users
                    </button>
                  </div>
                  {shareMode === 'specific' && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Select users to share with:</p>
                      {allUsersForShare.filter((u: any) => u.id !== ((trpc as any).auth?.me?.data?.id ?? 0)).map((u: any) => (
                        <label key={u.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                          <input
                            type="checkbox"
                            checked={shareUserIds.includes(u.id)}
                            onChange={e => setShareUserIds(prev => e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id))}
                            className="rounded"
                          />
                          <span className="text-sm">{u.name || u.email}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{u.email}</span>
                        </label>
                      ))}
                      {allUsersForShare.length === 0 && <p className="text-xs text-muted-foreground italic">No other users found.</p>}
                    </div>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShareDialogId(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={shareSmartlistMutation.isPending}
                    onClick={() => {
                      if (shareDialogId === null) return;
                      shareSmartlistMutation.mutate({
                        id: shareDialogId,
                        isPublic: shareMode === 'public',
                        sharedWith: shareMode === 'specific' ? shareUserIds : null,
                      });
                    }}
                  >
                    {shareSmartlistMutation.isPending ? <Loader2 size={12} className="animate-spin mr-1" /> : <Share2 size={12} className="mr-1" />}
                    Save Sharing
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Bulk Tag Dialog */}
            <Dialog open={bulkTagDialogOpen} onOpenChange={(open) => { setBulkTagDialogOpen(open); if (!open) { setBulkTagId("none"); setBulkShowNewTag(false); setBulkNewTagName(""); setBulkNewTagColor(TAG_COLORS[0]); } }}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Add Tag to {selectedContactIds.size} Contact{selectedContactIds.size !== 1 ? "s" : ""}</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-xs text-muted-foreground mb-2">Click a tag to apply it instantly</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map((t) => (
                      <button
                        key={t.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: t.color + "22", borderColor: t.color + "66", color: t.color }}
                        onClick={() => {
                          bulkAddTagMutation.mutate(
                            { contactIds: Array.from(selectedContactIds), tagId: t.id },
                            { onSuccess: () => { setBulkTagDialogOpen(false); setBulkTagId("none"); } }
                          );
                        }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-border/50 mt-3 pt-3">
                    {!bulkShowNewTag ? (
                      <button
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setBulkShowNewTag(true)}
                      >
                        <Plus size={12} /> Create new tag
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <input
                          autoFocus
                          className="w-full text-sm bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Tag name…"
                          value={bulkNewTagName}
                          onChange={e => setBulkNewTagName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && bulkNewTagName.trim()) {
                              createTagMutation.mutate({ name: bulkNewTagName.trim(), color: bulkNewTagColor }, {
                                onSuccess: (tag) => {
                                  bulkAddTagMutation.mutate(
                                    { contactIds: Array.from(selectedContactIds), tagId: tag.id },
                                    { onSuccess: () => { setBulkTagDialogOpen(false); setBulkShowNewTag(false); setBulkNewTagName(""); } }
                                  );
                                }
                              });
                            }
                            if (e.key === "Escape") { setBulkShowNewTag(false); setBulkNewTagName(""); }
                          }}
                        />
                        <div className="flex gap-1.5 flex-wrap">
                          {TAG_COLORS.map(c => (
                            <button key={c} onClick={() => setBulkNewTagColor(c)}
                              className={`w-5 h-5 rounded-full transition-transform ${ bulkNewTagColor === c ? "ring-2 ring-offset-1 ring-foreground/40 scale-110" : "hover:scale-105" }`}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1"
                            disabled={!bulkNewTagName.trim() || createTagMutation.isPending}
                            onClick={() => {
                              createTagMutation.mutate({ name: bulkNewTagName.trim(), color: bulkNewTagColor }, {
                                onSuccess: (tag) => {
                                  bulkAddTagMutation.mutate(
                                    { contactIds: Array.from(selectedContactIds), tagId: tag.id },
                                    { onSuccess: () => { setBulkTagDialogOpen(false); setBulkShowNewTag(false); setBulkNewTagName(""); } }
                                  );
                                }
                              });
                            }}
                          >
                            {createTagMutation.isPending ? <><Loader2 size={12} className="animate-spin mr-1" />Creating…</> : "Create & Apply"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setBulkShowNewTag(false); setBulkNewTagName(""); }}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Bulk Remove Tag Dialog */}
            <Dialog open={bulkRemoveTagDialogOpen} onOpenChange={setBulkRemoveTagDialogOpen}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Remove Tag from {selectedContactIds.size} Contact{selectedContactIds.size !== 1 ? "s" : ""}</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-xs text-muted-foreground mb-2">Click a tag to remove it from all selected contacts</p>
                  {allTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags exist yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.map((t) => (
                        <button
                          key={t.id}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border hover:opacity-80 transition-opacity"
                          style={{ backgroundColor: t.color + "22", borderColor: t.color + "66", color: t.color }}
                          disabled={bulkRemoveTagMutation.isPending}
                          onClick={() => {
                            bulkRemoveTagMutation.mutate({ contactIds: Array.from(selectedContactIds), tagId: t.id });
                          }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            {/* Bulk Set Status Dialog */}
            <Dialog open={bulkStatusDialogOpen} onOpenChange={setBulkStatusDialogOpen}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Set Status for {selectedContactIds.size} Contact{selectedContactIds.size !== 1 ? "s" : ""}</DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-xs text-muted-foreground mb-3">Choose a status to apply to all selected contacts</p>
                  <div className="flex flex-col gap-1">
                    {CONTACT_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all hover:opacity-90"
                        style={{ backgroundColor: s.bg, borderColor: s.color + "44", color: s.color }}
                        disabled={bulkSetStatusMutation.isPending}
                        onClick={() => bulkSetStatusMutation.mutate({ contactIds: Array.from(selectedContactIds), status: s.value })}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        {s.label}
                      </button>
                    ))}
                    <button
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground border border-dashed border-border hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5 transition-all mt-1"
                      disabled={bulkSetStatusMutation.isPending}
                      onClick={() => bulkSetStatusMutation.mutate({ contactIds: Array.from(selectedContactIds), status: null })}
                    >
                      <X size={12} /> Clear status
                    </button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
        {/* ── FULL-WIDTH SETTINGS PANEL ─────────────────────────────────── */}
        {leftTab === "settings" && (
          <SettingsPanel allTags={allTags} />
        )}
        {/* ── FULL-WIDTH AUTOMATIONS PANEL ─────────────────────────────── */}
        {leftTab === "automations" && (
          <AutomationsPanel allTags={allTags} />
        )}
        {/* ── FULL-WIDTH APPOINTMENTS PANEL ────────────────────────────── */}
        {leftTab === "appointments" && (
          <AppointmentsPanel />
        )}

        {leftTab === "power" && (
          <div className="flex-1 overflow-hidden">
            <PowerDialler phone={phone} />
          </div>
        )}

        {/* ── ASIDE + MAIN (conversations only) ───────────────────────────── */}
        {leftTab === "conversations" && <>
        <aside className="w-80 shrink-0 border-r border-border flex flex-col overflow-hidden bg-background">
          {/* ── OLD CONTACTS PANEL SLOT (now unused) ──────────────────────── */}
          {false && (
            <div>
              <div>
                <button
                  onClick={() => setShowContactFilters(v => !v)}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                    showContactFilters || contactDateFrom || contactDateTo || contactTagFilters.length > 0
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  }`}
                >
                  <Filter size={11} />
                  Filters
                  {(contactDateFrom || contactDateTo || contactTagFilters.length > 0) && (
                    <span className="ml-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                      {[contactDateFrom ? 1 : 0, contactDateTo ? 1 : 0, contactTagFilters.length > 0 ? 1 : 0].reduce((a, b) => a + b, 0)}
                    </span>
                  )}
                </button>
              </div>

              {/* Filter panel */}
              {showContactFilters && (
                <div className="px-4 py-3 border-b border-border shrink-0 space-y-3 bg-muted/20">
                  {/* Date range */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Date Created</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">From</label>
                        <Input
                          type="date"
                          value={contactDateFrom}
                          onChange={(e) => setContactDateFrom(e.target.value)}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">To</label>
                        <Input
                          type="date"
                          value={contactDateTo}
                          onChange={(e) => setContactDateTo(e.target.value)}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                    </div>
                  </div>
                  {/* Tag filter */}
                  {allTags.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Tag</p>
                      <div className="flex flex-wrap gap-1.5">
                        {allTags.map((t) => {
                          const active = contactTagFilters.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              onClick={() => setContactTagFilters(active ? [] : [t.id])}
                              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border transition-all ${
                                active ? "border-transparent text-white" : "border-border text-muted-foreground hover:text-foreground"
                              }`}
                              style={active ? { backgroundColor: t.color, borderColor: t.color } : {}}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Clear filters */}
                  {(contactDateFrom || contactDateTo || contactTagFilters.length > 0) && (
                    <button
                      onClick={() => { setContactDateFrom(""); setContactDateTo(""); setContactTagFilters([]); }}
                      className="text-[10px] text-destructive hover:text-destructive/80 flex items-center gap-1"
                    >
                      <X size={10} /> Clear all filters
                    </button>
                  )}
                </div>
              )}

              {/* Bulk action toolbar */}
              {selectedContactIds.size > 0 && (
                <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2 bg-primary/5">
                  <span className="text-xs font-medium text-primary">{selectedContactIds.size} selected</span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => setBulkTagDialogOpen(true)}
                  >
                    <Tag size={11} /> Add Tag
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => {
                      if (!confirm(`Delete ${selectedContactIds.size} contact${selectedContactIds.size !== 1 ? "s" : ""}?`)) return;
                      bulkDeleteMutation.mutate({ ids: Array.from(selectedContactIds) });
                    }}
                    disabled={bulkDeleteMutation.isPending}
                  >
                    {bulkDeleteMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                    Delete
                  </Button>
                </div>
              )}

              {/* Table */}
              {contactList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center">
                    <Users size={22} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">No contacts found</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {(contactDateFrom || contactDateTo || contactTagFilters.length > 0)
                        ? "Try adjusting your filters"
                        : "Upload a CSV or save a contact from the conversation view"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
                  {/* Table header */}
                  <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <div className="w-5 shrink-0">
                      <Checkbox
                        checked={selectedContactIds.size === contactList.length && contactList.length > 0}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedContactIds(new Set(contactList.map(c => c.id)));
                          else setSelectedContactIds(new Set());
                        }}
                        className="w-3.5 h-3.5"
                      />
                    </div>
                    <div className="flex-1 min-w-0">Name</div>
                    <div className="w-28 shrink-0">Phone</div>
                    <div className="w-20 shrink-0">Tags</div>
                    <div className="w-20 shrink-0">Date</div>
                  </div>
                  {/* Table rows */}
                  <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
                    {contactList.map((c) => {
                      const isSelected = selectedContactIds.has(c.id);
                      return (
                        <ContactTableRow
                          key={c.id}
                          contact={c}
                          initialTags={(c as any).tags ?? []}
                          selected={isSelected}
                          onToggle={() => {
                            setSelectedContactIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            });
                          }}
                          onClick={() => {
                            setActiveContact({ phone: c.phone, name: c.name ?? undefined, leadId: undefined });
                            setLeftTabPersist("conversations");
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── CONVERSATIONS PANEL ──────────────────────────────────────────────── */}
          {true && <>
          {/* Dial tabs — top section */}
          <Tabs defaultValue="csv" className="flex flex-col flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            <div className="px-4 pt-3 pb-0 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <TabsList className="h-8 bg-muted">
                  <TabsTrigger value="csv" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <PhoneCall size={12} /> Contacts
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <Hash size={12} /> Manual Dial
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            {/* Contacts tab */}
            <TabsContent value="csv" className="mt-0 flex-1 overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
              {sessionId && (
                <div className="px-3 py-2 border-b border-border shrink-0 space-y-2">
                  {/* Search */}
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search leads…"
                      className="pl-7 h-7 text-xs bg-input border-border text-foreground placeholder:text-muted-foreground" />
                    {search && (
                      <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                  {/* Tag filter chips — shared with Contacts table */}
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => setContactTagFilters([])}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          contactTagFilters.length === 0
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        All
                      </button>
                      {allTags.map((t) => {
                        const active = contactTagFilters.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => setContactTagFilters(active ? [] : [t.id])}
                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                              active
                                ? "text-white border-transparent"
                                : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                            style={active ? { backgroundColor: t.color, borderColor: t.color } : {}}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
                {activePhonesQuery.isLoading ? (
                  <div className="flex items-center justify-center h-16">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                ) : activeContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 h-32 px-4 text-center">
                    <p className="text-sm font-medium text-foreground">No conversations yet</p>
                    <p className="text-xs text-muted-foreground">Contacts appear here after a call or message</p>
                  </div>
                ) : (() => {
                  const summaryMap = new Map(convSummaries.map(s => [s.phone, s]));
                  const sorted = [...activeContacts].sort((a, b) => {
                    const aUnread = unreadPhones.has(a.phone) ? 1 : 0;
                    const bUnread = unreadPhones.has(b.phone) ? 1 : 0;
                    if (aUnread !== bUnread) return bUnread - aUnread;
                    const aTime = summaryMap.get(a.phone)?.lastActivityAt;
                    const bTime = summaryMap.get(b.phone)?.lastActivityAt;
                    if (aTime && bTime) return new Date(bTime).getTime() - new Date(aTime).getTime();
                    return 0;
                  });
                  const unread = sorted.filter(c => unreadPhones.has(c.phone));
                  const recent = sorted.filter(c => !unreadPhones.has(c.phone));

                  const renderContact = (contact: typeof activeContacts[0]) => {
                    const summary = summaryMap.get(contact.phone);
                    const isUnread = unreadPhones.has(contact.phone);
                    return (
                      <button
                        key={contact.id}
                        onClick={() => {
                          setActiveContact({ phone: contact.phone, name: contact.name || contact.phone });
                          setSelectedLeadId(null);
                          markRead(contact.phone);
                        }}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-accent/50 ${
                          activeContact?.phone === contact.phone ? "bg-accent" : ""
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUnread ? "bg-blue-500/20" : "bg-primary/10"}`}>
                          <span className={`text-[11px] font-semibold ${isUnread ? "text-blue-500" : "text-primary"}`}>
                            {(contact.name || contact.phone).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-sm truncate ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                              {contact.name || contact.phone}
                            </p>
                            {isUnread && (
                              <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                            )}
                          </div>
                          {contact.name && <p className="text-[11px] text-muted-foreground truncate">{contact.phone}</p>}
                          {isUnread && summary?.lastInboundPreview && (
                            <p className="text-[11px] text-blue-400 truncate mt-0.5">{summary.lastInboundPreview}</p>
                          )}
                        </div>
                      </button>
                    );
                  };

                  return (
                    <div className="py-1">
                      {unread.length > 0 && (
                        <>
                          <p className="px-3 py-1 text-[10px] text-blue-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                            Unread · {unread.length}
                          </p>
                          {unread.map(renderContact)}
                          {recent.length > 0 && <div className="mx-3 my-1 border-t border-border" />}
                        </>
                      )}
                      {recent.length > 0 && (
                        <>
                          <p className="px-3 py-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
                            {unread.length > 0 ? `Recent · ${recent.length}` : `${sorted.length} conversation${sorted.length !== 1 ? "s" : ""}`}
                          </p>
                          {recent.map(renderContact)}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            </TabsContent>

            {/* Manual Dial tab */}
            <TabsContent value="manual" className="mt-0 p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Phone Number</label>
                <div className="flex h-9 rounded-md border border-border bg-input overflow-hidden focus-within:ring-1 focus-within:ring-ring">
                  <div className="relative shrink-0">
                    <select
                      value={manualCountry}
                      onChange={(e) => setManualCountry(e.target.value as "AU" | "US")}
                      className="h-full pl-2 pr-6 bg-transparent text-sm text-foreground appearance-none cursor-pointer border-r border-border focus:outline-none"
                      style={{ minWidth: "72px" }}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.flag} {c.dialCode}</option>
                      ))}
                    </select>
                    <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                  <input
                    type="tel"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder={manualCountry === "AU" ? "0412 345 678" : "(555) 000-0000"}
                    className="flex-1 px-3 bg-transparent text-sm text-foreground placeholder:text-muted-foreground font-mono focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const full = buildFullPhone();
                        if (!full) { toast.error("Enter a phone number"); return; }
                        if (phone.phoneState !== "ready") { toast.error("Connect your microphone first"); return; }
                        const contact: ActiveContact = { phone: full, name: manualName.trim() };
                        setActiveContact(contact); setSelectedLeadId(null);
                        phone.dial(full);
                        toast.success(`Calling ${manualName.trim() || full}…`);
                      }
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {selectedCountry.flag} {selectedCountry.label} · will dial as {buildFullPhone() || `${selectedCountry.dialCode}…`}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Name (optional)</label>
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Contact name"
                  className="h-9 text-sm bg-input border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <Button
                onClick={() => {
                  if (callIsActive) { phone.hangup(); return; }
                  const full = buildFullPhone();
                  if (!full) { toast.error("Enter a phone number"); return; }
                  if (phone.phoneState !== "ready") { toast.error("Connect your microphone first"); return; }
                  const contact: ActiveContact = { phone: full, name: manualName.trim() };
                  setActiveContact(contact); setSelectedLeadId(null);
                  phone.dial(full);
                  toast.success(`Calling ${manualName.trim() || full}…`);
                }}
                className={`w-full gap-2 font-medium ${
                  phone.phoneState === "active"
                    ? "bg-destructive/20 text-destructive border border-destructive/30 hover:bg-destructive/30"
                    : callIsActive
                    ? "bg-blue-500/20 text-blue-600 border border-blue-500/30 dark:text-blue-400"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }`}
              >
                {callIsActive ? (
                  phone.phoneState === "active"
                    ? <><PhoneOff size={14} /> End Call</>
                    : <><Loader2 size={14} className="animate-spin" /> Connecting…</>
                ) : (
                  <><Phone size={14} /> Call Now</>
                )}
              </Button>
            </TabsContent>
          </Tabs>

          {/* Global call history */}
          <div className="flex-1 overflow-hidden flex flex-col border-t border-border">
            <div className="px-4 py-2 shrink-0 flex items-center gap-2">
              <History size={12} className="text-muted-foreground" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Call History</span>
              {allCalls.length > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground/60">{allCalls.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {allCalls.length === 0 ? (
                <div className="flex items-center justify-center h-16">
                  <p className="text-xs text-muted-foreground/60">No calls yet</p>
                </div>
              ) : (
                allCalls.map((record) => (
                  <GlobalCallRow
                    key={record.id}
                    record={record}
                    active={activeContact?.phone === record.phone}
                    onClick={() => openContactFromHistory(record)}
                  />
                ))
              )}
            </div>
          </div>
          </>}
        </aside>
        {/* ── RIGHT PANEL — Conversation Window ─────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-background/95">
          {!activeContact ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <Phone size={24} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No Active Contact</p>
                <p className="text-sm text-muted-foreground mt-1">Select a lead, enter a number in Manual Dial, or pick from Call History</p>
              </div>
              {phone.phoneState === "idle" && (
                <Button onClick={phone.initialize} variant="outline" className="gap-2 mt-2">
                  <Mic size={14} /> Connect Microphone
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">

              {/* Contact strip */}
              <div className="px-6 py-4 border-b border-border shrink-0">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                    {(activeContact.name || activeContact.phone).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-foreground tracking-tight truncate">
                      {activeContact.name || activeContact.phone}
                    </h2>
                    {activeContact.name && (
                      <p className="text-xs font-mono text-muted-foreground">{activeContact.phone}</p>
                    )}
                    {selectedLead?.company && (
                      <p className="text-xs text-muted-foreground/70">{selectedLead.company}</p>
                    )}
                    {/* Show tags for saved contact */}
                    {savedContactTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {savedContactTags.map((t) => (
                          <span
                            key={t.id}
                            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                            style={{ backgroundColor: t.color }}
                          >
                            <Tag size={8} />
                            {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Custom fields from saved contact */}
                    {savedContact && (savedContact.source || savedContact.criteria1 || savedContact.criteria2 || savedContact.criteria3 || savedContact.criteria4 || savedContact.criteria5) && (
                      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1">
                        {savedContact.source && (
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground">Source</span>
                            <span className="text-xs text-foreground truncate">{savedContact.source}</span>
                          </div>
                        )}
                        {[1,2,3,4,5].map((n) => {
                          const val = savedContact[`criteria${n}` as keyof typeof savedContact] as string | null;
                          if (!val) return null;
                          return (
                            <div key={n} className="flex flex-col">
                              <span className="text-[10px] text-muted-foreground">Criteria {n}</span>
                              <span className="text-xs text-foreground truncate">{val}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Add / Edit Contact button */}
                  <button
                    title={savedContact ? "Edit Contact" : "Add Contact"}
                    onClick={() => {
                      setContactForm({
                        phone:     "",
                        name:      savedContact?.name ?? activeContact.name ?? "",
                        email:     savedContact?.email ?? "",
                        company:   savedContact?.company ?? selectedLead?.company ?? "",
                        notes:     savedContact?.notes ?? "",
                        source:    savedContact?.source ?? "",
                        criteria1: savedContact?.criteria1 ?? "",
                        criteria2: savedContact?.criteria2 ?? "",
                        criteria3: savedContact?.criteria3 ?? "",
                        criteria4: savedContact?.criteria4 ?? "",
                        criteria5: savedContact?.criteria5 ?? "",
                        tagIds:    savedContactTags.map((t) => t.id),
                        status:    (savedContact as any)?.status ?? "",
                        outcome:   (savedContact as any)?.outcome ?? "",
                        timezone:  (savedContact as any)?.timezone ?? "",
                        closer:           (savedContact as any)?.closer ?? "",
                        priceQuoted:      (savedContact as any)?.priceQuoted ?? "",
                        callRecordingUrl: (savedContact as any)?.callRecordingUrl ?? "",
                        objections:       (savedContact as any)?.objections ?? "",
                        dealResult:       (savedContact as any)?.dealResult ?? "",
                      });
                      setContactDialogOpen(true);
                    }}
                    className="shrink-0 w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {savedContact ? <UserCheck size={15} /> : <UserPlus size={15} />}
                  </button>
                  {/* Disposition — CSV leads only */}
                  {activeContact.leadId && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {DISPOSITIONS.map((d) => {
                        const isActive = currentDisposition === d.value;
                        return (
                          <button key={d.value} onClick={() => handleDisposition(d.value)} title={d.label}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                              isActive ? `badge-${d.value}` : "bg-card border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                            }`}>
                            {d.icon}
                            <span className="hidden lg:inline">{d.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Extra data for CSV leads */}
                {(() => {
                  const extra = selectedLead?.extraData as Record<string, string> | null | undefined;
                  if (!extra || Object.keys(extra).length === 0) return null;
                  const pairs = Object.entries(extra).filter(([, v]) => v).slice(0, 8) as [string, string][];
                  if (pairs.length === 0) return null;
                  return (
                    <div className="mt-3 grid grid-cols-4 gap-x-4 gap-y-1">
                      {pairs.map(([k, v]) => (
                        <div key={k} className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                          <span className="text-xs text-foreground truncate">{v}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Call button */}
              <div className="px-6 py-3 border-b border-border shrink-0 flex flex-col gap-2">
               <div className="flex items-center gap-3">
                <Button
                  onClick={handleCall}
                  size="sm"
                  style={{
                    boxShadow: phone.phoneState === 'active'
                      ? '0 0 18px 2px oklch(0.55 0.22 25 / 0.50)'
                      : phone.phoneState === 'ringing'
                      ? '0 0 18px 2px oklch(0.75 0.18 80 / 0.45)'
                      : callIsActive
                      ? '0 0 14px 2px oklch(0.60 0.18 240 / 0.40)'
                      : '0 0 18px 3px oklch(0.60 0.20 155 / 0.55)'
                  }}
                  className={`gap-2 font-medium min-w-[120px] ${
                    phone.phoneState === "ringing"
                      ? "bg-amber-500/20 text-amber-600 border border-amber-500/30 dark:text-amber-400 animate-pulse hover:bg-amber-500/30"
                      : phone.phoneState === "active"
                      ? "bg-destructive/20 text-destructive border border-destructive/30 hover:bg-destructive/30"
                      : callIsActive
                      ? "bg-blue-500/20 text-blue-600 border border-blue-500/30 dark:text-blue-400"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  {phone.phoneState === "ringing" ? (
                    <><Phone size={13} className="animate-pulse" /> Ringing…</>
                  ) : phone.phoneState === "active" ? (
                    <><PhoneOff size={13} /> End · <span className="font-mono text-xs">{formatDuration(callElapsed)}</span></>
                  ) : callIsActive ? (
                    <><Loader2 size={13} className="animate-spin" /> Connecting…</>
                  ) : (
                    <><Phone size={13} /> Call Now</>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground flex-1">
                  {activeContact.name ? `${activeContact.name} · ` : ""}{activeContact.phone}
                </p>
                {!phone.conferenceToken && (
                  <ConferencePanel
                    phone={phone}
                    customerPhone={activeContact.phone}
                    customerName={activeContact.name}
                  />
                )}
               </div>
               {phone.conferenceToken && (
                <ConferencePanel
                  phone={phone}
                  customerPhone={activeContact.phone}
                  customerName={activeContact.name}
                />
               )}
              </div>

              {/* Unified conversation + Notes + Email tabs — always shown for all contacts */}
              <div className="flex-1 overflow-hidden">
                <Tabs defaultValue="conversation" className="flex flex-col h-full">
                  <div className="px-6 pt-2 shrink-0 border-b border-border">
                    <TabsList className="h-8 bg-muted">
                      <TabsTrigger value="conversation" className="text-xs gap-1 data-[state=active]:bg-background data-[state=active]:text-foreground">
                        <MessageSquare size={12} /> Conversation
                      </TabsTrigger>
                      <TabsTrigger value="notes" className="text-xs gap-1 data-[state=active]:bg-background data-[state=active]:text-foreground">
                        <FileText size={12} /> Notes
                      </TabsTrigger>
                      <TabsTrigger value="email" className="text-xs gap-1 data-[state=active]:bg-background data-[state=active]:text-foreground">
                        <Mail size={12} /> Email
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="conversation" className="flex-1 overflow-hidden mt-0 p-0">
                    <ConversationTimeline
                      events={timelineEvents}
                      sending={smsMutation.isPending || blooioMutation.isPending}
                      onSend={handleSMS}
                      contactName={activeContact.name}
                      contactPhone={activeContact.phone}
                      iMessageMode={iMessageMode}
                      onToggleChannel={setIMessageMode}
                    />
                  </TabsContent>
                  <TabsContent value="notes" className="flex-1 overflow-auto mt-0 px-6 py-4">
                    <Textarea
                      value={notesValue}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      placeholder="Add notes about this contact…"
                      className="w-full bg-card border-border text-foreground placeholder:text-muted-foreground min-h-[200px] resize-none focus:ring-1 focus:ring-ring text-sm leading-relaxed"
                    />
                    <p className="text-xs text-muted-foreground/50 mt-2">Auto-saved as you type</p>
                  </TabsContent>
                  <TabsContent value="email" className="flex flex-col h-full mt-0 overflow-hidden">
                    {/* Email thread */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                      {emailMessages.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-8">
                          {contactEmail ? 'No emails yet' : 'No email address on file for this contact'}
                        </p>
                      )}
                      {emailMessages.map((msg) => (
                        <div key={msg.id} className={`flex flex-col gap-0.5 ${msg.direction === 'outbound' ? 'items-end' : 'items-start'}`}>
                          <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                            msg.direction === 'outbound'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground'
                          }`}>
                            {msg.subject && <p className="font-semibold text-xs mb-1 opacity-80">{msg.subject}</p>}
                            <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                          </div>
                          <p className="text-[10px] text-muted-foreground/60 px-1">
                            {new Date(msg.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                    {/* Compose area */}
                    <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
                      {!contactEmail && (
                        <p className="text-xs text-amber-500 mb-1">⚠️ No email on file — add one in the contact editor first</p>
                      )}
                      <Input
                        placeholder="Subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="h-8 text-sm"
                        disabled={!contactEmail}
                      />
                      <Textarea
                        ref={emailBodyRef}
                        placeholder={contactEmail ? `Email to ${contactEmail}…` : 'No email address on file'}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        className="min-h-[80px] text-sm resize-none"
                        disabled={!contactEmail}
                      />
                      {contactEmail && (
                        <div className="flex items-center justify-between">
                          <PlaceholderPicker
                            targetRef={emailBodyRef}
                            onInsert={(token) => setEmailBody(prev => prev + token)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0 gap-1 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 h-7 px-2 text-xs"
                            onClick={() => setEmailAiOpen(v => !v)}
                          >
                            <Sparkles size={12} /> Ask AI
                          </Button>
                        </div>
                      )}
                      {emailAiOpen && contactEmail && (
                        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2 space-y-2">
                          <p className="text-[10px] text-violet-300 font-medium">Describe the email body you want to send…</p>
                          <div className="flex gap-2">
                            <Textarea
                              value={emailAiPrompt}
                              onChange={e => setEmailAiPrompt(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (emailAiPrompt.trim()) emailAiMutation.mutate({ prompt: emailAiPrompt.trim(), channel: "email", contactName: activeContact?.name || undefined, contactPhone: activeContact?.phone || undefined }); } }}
                              placeholder="e.g. Follow up on the call, mention the zoom link and ask if they have questions"
                              rows={2}
                              className="flex-1 text-xs resize-none bg-background/50 border-violet-500/30 focus:border-violet-400"
                              disabled={emailAiMutation.isPending}
                            />
                            <button
                              onClick={() => { if (emailAiPrompt.trim()) emailAiMutation.mutate({ prompt: emailAiPrompt.trim(), channel: "email", contactName: activeContact?.name || undefined, contactPhone: activeContact?.phone || undefined }); }}
                              disabled={!emailAiPrompt.trim() || emailAiMutation.isPending}
                              className="self-end w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center transition-colors shrink-0"
                            >
                              {emailAiMutation.isPending ? <Loader2 size={12} className="animate-spin text-white" /> : <Send size={12} className="text-white" />}
                            </button>
                          </div>
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="w-full gap-1.5"
                        disabled={!contactEmail || !emailSubject.trim() || !emailBody.trim() || emailSendMutation.isPending}
                        onClick={() => {
                          if (!contactEmail) return;
                          emailSendMutation.mutate({ to: contactEmail, subject: emailSubject.trim(), body: emailBody.trim() });
                        }}
                      >
                        {emailSendMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Send Email
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

            </div>
          )}
        </main>
        </>}
      </div>
      {/* ── CSV Field Mapping Modall ─────────────────────────────────────────── */}
      {csvPending && (
        <CsvMappingModal
          open={!!csvPending}
          headers={csvPending.headers}
          previewRows={csvPending.rows.slice(0, 3)}
          allRows={csvPending.rows}
          totalRows={csvPending.rows.length}
          allTags={allTags}
          onImport={handleCsvImport}
          onCancel={() => setCsvPending(null)}
          onCreateTag={async (name, color) => {
            const tag = await createTagMutation.mutateAsync({ name, color });
            return tag;
          }}
        />
      )}

      {/* ── Add / Edit Contact Dialog ───────────────────────────────────────── */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{savedContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone <span className="text-destructive">*</span></Label>
              {activeContact?.phone ? (
                <Input id="c-phone" value={activeContact.phone} disabled className="font-mono text-sm" />
              ) : (
                <Input
                  id="c-phone"
                  placeholder="+61400000000"
                  value={contactForm.phone}
                  onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
                  className="font-mono text-sm"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name <span className="text-destructive">*</span></Label>
              <Input id="c-name" placeholder="Full name" value={contactForm.name}
                onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" placeholder="email@example.com" value={contactForm.email}
                  onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-company">Company</Label>
                <Input id="c-company" placeholder="Company name" value={contactForm.company}
                  onChange={e => setContactForm(f => ({ ...f, company: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-source">Source</Label>
              <Input id="c-source" placeholder="e.g. LinkedIn, Referral, Cold outreach" value={contactForm.source}
                onChange={e => setContactForm(f => ({ ...f, source: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Criteria</Label>
              <div className="grid grid-cols-2 gap-2">
                {[1,2,3,4,5].map((n) => {
                  const key = `criteria${n}` as keyof typeof contactForm;
                  return (
                    <div key={n} className="space-y-1">
                      <Label htmlFor={`c-criteria${n}`} className="text-xs text-muted-foreground">Criteria {n}</Label>
                      <Input
                        id={`c-criteria${n}`}
                        placeholder={`Criteria ${n}`}
                        value={contactForm[key] as string}
                        onChange={e => setContactForm(f => ({ ...f, [key]: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Status selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</Label>
              <div className="flex flex-wrap gap-1.5">
                {CONTACT_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setContactForm(f => ({ ...f, status: f.status === s.value ? "" : s.value }))}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                    style={contactForm.status === s.value
                      ? { backgroundColor: s.bg, borderColor: s.color + "66", color: s.color }
                      : { backgroundColor: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {/* ── Scalbl.io sales-pipeline fields ── */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deal Result</Label>
              <div className="flex flex-wrap gap-1.5">
                {DEAL_RESULTS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setContactForm(f => ({ ...f, dealResult: f.dealResult === d.value ? "" : d.value }))}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                    style={contactForm.dealResult === d.value
                      ? { backgroundColor: d.bg, borderColor: d.color + "66", color: d.color }
                      : { backgroundColor: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="c-closer" className="text-xs text-muted-foreground">Closer</Label>
                <Input id="c-closer" placeholder="Who ran the call" value={contactForm.closer}
                  onChange={e => setContactForm(f => ({ ...f, closer: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-price" className="text-xs text-muted-foreground">Price Quoted</Label>
                <Input id="c-price" placeholder="e.g. 1800" value={contactForm.priceQuoted}
                  onChange={e => setContactForm(f => ({ ...f, priceQuoted: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-recording" className="text-xs text-muted-foreground">Call Recording URL</Label>
              <Input id="c-recording" placeholder="Fathom or Drive link" value={contactForm.callRecordingUrl}
                onChange={e => setContactForm(f => ({ ...f, callRecordingUrl: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-objections" className="text-xs text-muted-foreground">Objections</Label>
              <Textarea id="c-objections" placeholder="Short notes on objections…" rows={2} value={contactForm.objections}
                onChange={e => setContactForm(f => ({ ...f, objections: e.target.value }))} />
            </div>
            {/* Tag selector */}
            {allTags.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</Label>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((t) => {
                    const selected = contactForm.tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setContactForm(f => ({
                          ...f,
                          tagIds: selected
                            ? f.tagIds.filter(id => id !== t.id)
                            : [...f.tagIds, t.id],
                        }))}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium border transition-all ${
                          selected ? "text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                        style={selected ? { backgroundColor: t.color, borderColor: t.color } : {}}
                      >
                        <Tag size={10} />
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="c-timezone">Timezone</Label>
              <Select value={contactForm.timezone || ""} onValueChange={v => setContactForm(f => ({ ...f, timezone: v }))}>
                <SelectTrigger id="c-timezone" className="w-full">
                  <SelectValue placeholder="Select timezone…" />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  {[
                    "Pacific/Honolulu","America/Anchorage","America/Los_Angeles","America/Denver",
                    "America/Chicago","America/New_York","America/Sao_Paulo","Europe/London",
                    "Europe/Paris","Europe/Berlin","Europe/Moscow","Asia/Dubai","Asia/Kolkata",
                    "Asia/Bangkok","Asia/Singapore","Asia/Tokyo","Asia/Seoul","Australia/Perth",
                    "Australia/Adelaide","Australia/Sydney","Pacific/Auckland",
                  ].map(tz => (
                    <SelectItem key={tz} value={tz} className="text-xs">{tz.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea id="c-notes" placeholder="Any notes about this contact…" rows={3} value={contactForm.notes}
                onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!contactForm.name.trim() || (!activeContact?.phone && !contactForm.phone.trim()) || upsertContactMutation.isPending}
              onClick={() => {
                // Existing contacts already store an E.164 phone; only normalize manual entry.
                let phone = activeContact?.phone ?? "";
                if (!phone) {
                  const normalized = normalizeAuPhone(contactForm.phone);
                  if (!normalized) {
                    toast.error("Invalid phone number — enter a valid Australian or international number.");
                    return;
                  }
                  phone = normalized;
                }
                upsertContactMutation.mutate({
                  phone,
                  name:      contactForm.name.trim(),
                  email:     contactForm.email || undefined,
                  company:   contactForm.company || undefined,
                  notes:     contactForm.notes || undefined,
                  source:    contactForm.source || undefined,
                  criteria1: contactForm.criteria1 || undefined,
                  criteria2: contactForm.criteria2 || undefined,
                  criteria3: contactForm.criteria3 || undefined,
                  criteria4: contactForm.criteria4 || undefined,
                  criteria5: contactForm.criteria5 || undefined,
                  tagIds:    contactForm.tagIds,
                  status:    contactForm.status || undefined,
                  outcome:   contactForm.outcome || undefined,
                  timezone:  contactForm.timezone || undefined,
                  closer:           contactForm.closer || undefined,
                  priceQuoted:      contactForm.priceQuoted || undefined,
                  callRecordingUrl: contactForm.callRecordingUrl || undefined,
                  objections:       contactForm.objections || undefined,
                  dealResult:       contactForm.dealResult || undefined,
                });
              }}
            >
              {upsertContactMutation.isPending ? "Saving…" : "Save Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden file input — always mounted so fileInputRef works from any tab */}
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      <div className="fixed bottom-3 left-4 text-xs text-muted-foreground/40 select-none pointer-events-none">v1.89</div>
    </div>
  );
}

// ─── ContactListWithTags — separate component to load tags per contact ────────

function ContactListWithTags({
  contacts,
  tagFilter,
  onSelect,
}: {
  contacts: Contact[];
  tagFilter: number | null;
  onSelect: (c: Contact) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      {contacts.map((c) => (
        <ContactRowWithTags
          key={c.id}
          contact={c}
          tagFilter={tagFilter}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function ContactRowWithTags({
  contact,
  tagFilter,
  onSelect,
}: {
  contact: Contact;
  tagFilter: number | null;
  onSelect: (c: Contact) => void;
}) {
  const { data: contactTags = [] } = trpc.contacts.getTagsForContact.useQuery(
    { contactId: contact.id },
    { staleTime: 60_000 }
  );

  // Filter: if a tag filter is active, only show contacts that have that tag
  if (tagFilter !== null && !contactTags.some((t) => t.id === tagFilter)) {
    return null;
  }

  return (
    <button
      onClick={() => onSelect(contact)}
      className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-accent/50 transition-colors text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
        {(contact.name || contact.phone).slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
        <p className="text-xs font-mono text-muted-foreground truncate">{contact.phone}</p>
        {contactTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {contactTags.map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white"
                style={{ backgroundColor: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}


//// ─── OutcomeCell — inline editable notes/outcome field ────────────────────
function OutcomeCell({ contact, utils }: { contact: Contact; utils: ReturnType<typeof trpc.useUtils> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [optimistic, setOptimistic] = useState<string | undefined>(undefined);
  const current = optimistic !== undefined ? optimistic : ((contact as any).outcome ?? "");
  const setOutcomeMutation = trpc.contacts.setOutcome.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: () => setOptimistic(undefined),
  });
  return (
    <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setDraft(current); }}>
        <PopoverTrigger asChild>
          <button
            className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors truncate px-1 py-0.5 rounded hover:bg-accent"
            title={current || "Add notes / outcome"}
          >
            {current ? (
              <span className="truncate block">{current}</span>
            ) : (
              <span className="text-muted-foreground/50 italic">Add note…</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes / Outcome</p>
          <textarea
            autoFocus
            className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary resize-none"
            rows={4}
            placeholder="Add call outcome, notes…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 text-xs py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
              disabled={setOutcomeMutation.isPending}
              onClick={() => {
                const val = draft.trim() || null;
                setOptimistic(val ?? "");
                setOpen(false);
                setOutcomeMutation.mutate({ contactId: contact.id, outcome: val });
              }}
            >
              {setOutcomeMutation.isPending ? "Saving…" : "Save"}
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded hover:bg-accent text-muted-foreground"
              onClick={() => setOpen(false)}
            >Cancel</button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

//// ─── ContactTableRow — table row with embedded tags (no per-row query) ──────────
function ContactTableRow({
  contact,
  initialTags,
  visibleColumns,
  selected,
  onToggle,
  onClick,
}: {
  contact: Contact;
  initialTags: TagType[];
  visibleColumns?: Set<string>;
  selected: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  // When no set is provided, fall back to the default columns (keeps the secondary list unchanged).
  const show = (col: string) => visibleColumns ? visibleColumns.has(col) : DEFAULT_CONTACT_COLUMNS.includes(col);
  const utils = trpc.useUtils();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const { data: allTags = [] } = trpc.tags.list.useQuery(undefined, { staleTime: 60_000 });
  // Optimistic local tag state for instant UI feedback — seeded from embedded list data
  const [optimisticTagIds, setOptimisticTagIds] = useState<Set<number> | null>(null);
  const tagIds = optimisticTagIds ?? new Set(initialTags.map((t: TagType) => t.id));
  const contactTags = allTags.length > 0 ? allTags.filter(t => tagIds.has(t.id)) : initialTags.filter((t: TagType) => tagIds.has(t.id));
  const bulkAddTagMutation = trpc.contacts.bulkAddTag.useMutation({
    onSuccess: () => { setOptimisticTagIds(null); utils.contacts.list.invalidate(); },
    onError: () => { setOptimisticTagIds(null); },
  });
  const removeTagMutation = trpc.contacts.removeTag.useMutation({
    onSuccess: () => { setOptimisticTagIds(null); utils.contacts.list.invalidate(); },
    onError: () => { setOptimisticTagIds(null); },
  });
  const createTagRowMutation = trpc.tags.create.useMutation({
    onSuccess: (tag) => {
      utils.tags.list.invalidate();
      setOptimisticTagIds(prev => {
        const next = new Set<number>(prev ?? new Set<number>(initialTags.map((s: TagType) => s.id)));
        next.add(tag.id);
        return next;
      });
      bulkAddTagMutation.mutate({ contactIds: [contact.id], tagId: tag.id });
      setNewTagName("");
      setNewTagColor(TAG_COLORS[0]);
      setShowNewTagForm(false);
    },
  });
  // Status
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<string | null | undefined>(undefined);
  const currentStatus = optimisticStatus !== undefined ? optimisticStatus : (contact as any).status ?? null;
  const statusMeta = getStatusMeta(currentStatus);
  const setStatusRowMutation = trpc.contacts.setStatus.useMutation({
    onSuccess: () => { utils.contacts.list.invalidate(); utils.contacts.stats.invalidate(); },
    onError: () => setOptimisticStatus(undefined),
  });

  return (
    <tr
      className={`border-b border-border/50 transition-colors ${
        selected ? "bg-primary/5" : "hover:bg-accent/30"
      }`}
    >
      {/* Checkbox */}
      <td className="px-4 py-3 w-10" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        <Checkbox
          checked={selected}
          className="w-4 h-4 pointer-events-none cursor-pointer"
          onCheckedChange={() => {}}
        />
      </td>
      {/* Name */}
      {show("name") && (
      <td className="px-3 py-3 max-w-[176px] cursor-pointer" onClick={onClick}>
        <p className="text-sm font-medium text-foreground truncate">{contact.name || "—"}</p>
      </td>
      )}
      {/* Phone */}
      {show("phone") && (
      <td className="px-3 py-3 max-w-[128px] cursor-pointer" onClick={onClick}>
        <p className="text-xs font-mono text-muted-foreground truncate">{contact.phone}</p>
      </td>
      )}
      {/* Email */}
      {show("email") && (
      <td className="px-3 py-3 max-w-[176px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{contact.email || "—"}</p>
      </td>
      )}
      {/* Notes / Outcome — moved next to Email */}
      {show("outcome") && (
      <td className="px-3 py-3 max-w-[192px]" onClick={(e) => e.stopPropagation()}>
        <OutcomeCell contact={contact} utils={utils} />
      </td>
      )}
      {/* Company */}
      {show("company") && (
      <td className="px-3 py-3 max-w-[128px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{(contact as any).company || "—"}</p>
      </td>
      )}
      {/* Source */}
      {show("source") && (
      <td className="px-3 py-3 max-w-[112px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{(contact as any).source || "—"}</p>
      </td>
      )}
      {/* Criteria 1-5 */}
      {(["criteria1","criteria2","criteria3","criteria4","criteria5"] as const).filter(k => show(k)).map(k => (
        <td key={k} className="px-3 py-3 max-w-[112px] cursor-pointer" onClick={onClick}>
          <p className="text-xs text-muted-foreground truncate">{(contact as any)[k] || "—"}</p>
        </td>
      ))}
      {/* Timezone */}
      {show("timezone") && (
      <td className="px-3 py-3 max-w-[160px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{(contact as any).timezone || "—"}</p>
      </td>
      )}
      {/* Status cell */}
      {show("status") && (
      <td className="px-3 py-3 max-w-[112px]" onClick={(e) => e.stopPropagation()}>
        <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center justify-center px-2 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-90 w-full"
              style={statusMeta
                ? { backgroundColor: statusMeta.bg, color: statusMeta.color }
                : { backgroundColor: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)", border: "1px dashed rgba(255,255,255,0.15)" }}
            >
              <span className="truncate">{statusMeta ? statusMeta.label : "+ Status"}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1" align="start" onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">Set Status</p>
            {CONTACT_STATUSES.map(s => (
              <button
                key={s.value}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left transition-colors ${
                  currentStatus === s.value ? "bg-primary/10" : "hover:bg-accent"
                }`}
                onClick={() => {
                  setOptimisticStatus(s.value);
                  setStatusPopoverOpen(false);
                  setStatusRowMutation.mutate({ contactId: contact.id, status: s.value });
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                {s.label}
                {currentStatus === s.value && <span className="ml-auto text-primary text-[10px]">✓</span>}
              </button>
            ))}
            {currentStatus && (
              <button
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors mt-1 border-t border-border/50 pt-1.5"
                onClick={() => {
                  setOptimisticStatus(null);
                  setStatusPopoverOpen(false);
                  setStatusRowMutation.mutate({ contactId: contact.id, status: null });
                }}
              >
                <X size={10} /> Clear status
              </button>
            )}
          </PopoverContent>
        </Popover>
      </td>
      )}
      {/* Deal Result */}
      {show("dealResult") && (
      <td className="px-3 py-3 max-w-[112px] cursor-pointer" onClick={onClick}>
        {getDealResultMeta((contact as any).dealResult)
          ? <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: getDealResultMeta((contact as any).dealResult)!.bg, color: getDealResultMeta((contact as any).dealResult)!.color }}>{getDealResultMeta((contact as any).dealResult)!.label}</span>
          : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      )}
      {/* Closer */}
      {show("closer") && (
      <td className="px-3 py-3 max-w-[128px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{(contact as any).closer || "—"}</p>
      </td>
      )}
      {/* Price Quoted */}
      {show("priceQuoted") && (
      <td className="px-3 py-3 max-w-[112px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{(contact as any).priceQuoted || "—"}</p>
      </td>
      )}
      {/* Call Recording URL */}
      {show("callRecordingUrl") && (
      <td className="px-3 py-3 max-w-[176px]" onClick={(e) => e.stopPropagation()}>
        {(contact as any).callRecordingUrl
          ? <a href={(contact as any).callRecordingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate block">{(contact as any).callRecordingUrl}</a>
          : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      )}
      {/* Objections */}
      {show("objections") && (
      <td className="px-3 py-3 max-w-[192px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground truncate">{(contact as any).objections || "—"}</p>
      </td>
      )}
      {/* Tags + per-row tag button */}
      {show("tags") && (
      <td className="px-3 py-3 max-w-[144px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        {contactTags.slice(0, 2).map((t) => (
          <span
            key={t.id}
            className="text-[10px] px-2 py-0.5 rounded-full font-medium text-white truncate max-w-[72px]"
            style={{ backgroundColor: t.color }}
          >
            {t.name}
          </span>
        ))}
        {contactTags.length > 2 && (
          <span className="text-[10px] text-muted-foreground">+{contactTags.length - 2}</span>
        )}
        {/* Per-row tag popover */}
        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="ml-auto w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={(e) => { e.stopPropagation(); setTagPopoverOpen(true); }}
              title="Manage tags"
            >
              <Tag size={11} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2" align="end" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">Tags</p>
            <div className="flex flex-col gap-0.5">
              {allTags.map((t) => {
                const has = tagIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-left transition-colors ${
                      has ? "bg-primary/10 text-foreground" : "hover:bg-accent text-foreground"
                    }`}
                    onClick={() => {
                      if (!has) {
                        setOptimisticTagIds(prev => {
                          const next = new Set<number>(prev ?? new Set<number>(initialTags.map((s: TagType) => s.id)));
                          next.add(t.id);
                          return next;
                        });
                        bulkAddTagMutation.mutate({ contactIds: [contact.id], tagId: t.id });
                      } else {
                        setOptimisticTagIds(prev => {
                          const next = new Set<number>(prev ?? new Set<number>(initialTags.map((s: TagType) => s.id)));
                          next.delete(t.id);
                          return next;
                        });
                        removeTagMutation.mutate({ contactId: contact.id, tagId: t.id });
                      }
                    }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 truncate">{t.name}</span>
                    {has && <span className="text-[10px] text-primary font-medium">✓</span>}
                    {has && (
                      <span
                        className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOptimisticTagIds(prev => {
                            const next = new Set<number>(prev ?? new Set<number>(initialTags.map((s: TagType) => s.id)));
                            next.delete(t.id);
                            return next;
                          });
                          removeTagMutation.mutate({ contactId: contact.id, tagId: t.id });
                        }}
                      >
                        <X size={10} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-border/50 mt-1.5 pt-1.5">
              {!showNewTagForm ? (
                <button
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs w-full text-left text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={() => setShowNewTagForm(true)}
                >
                  <Plus size={11} /> New tag
                </button>
              ) : (
                <div className="flex flex-col gap-1.5 px-1">
                  <input
                    autoFocus
                    className="w-full text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Tag name…"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && newTagName.trim()) createTagRowMutation.mutate({ name: newTagName.trim(), color: newTagColor });
                      if (e.key === "Escape") { setShowNewTagForm(false); setNewTagName(""); }
                    }}
                  />
                  <div className="flex gap-1 flex-wrap">
                    {TAG_COLORS.map(c => (
                      <button key={c} onClick={() => setNewTagColor(c)}
                        className={`w-4 h-4 rounded-full transition-transform ${ newTagColor === c ? "ring-2 ring-offset-1 ring-foreground/40 scale-110" : "hover:scale-105" }`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <button
                      className="flex-1 text-xs py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
                      disabled={!newTagName.trim() || createTagRowMutation.isPending}
                      onClick={() => createTagRowMutation.mutate({ name: newTagName.trim(), color: newTagColor })}
                    >
                      {createTagRowMutation.isPending ? "Creating…" : "Create"}
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground"
                      onClick={() => { setShowNewTagForm(false); setNewTagName(""); }}
                    >Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      </td>
      )}
      {/* Date */}
      {show("createdAt") && (
      <td className="px-3 py-3 max-w-[112px] cursor-pointer" onClick={onClick}>
        <p className="text-xs text-muted-foreground">
          {contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : "—"}
        </p>
      </td>
      )}
    </tr>
  );
}

// ─── Contacts Kanban View ─────────────────────────────────────────────────────

const KANBAN_STAGES: { value: string | null; label: string; color: string; bg: string }[] = [
  { value: null,              label: "No Status",       color: "#94a3b8", bg: "#94a3b822" },
  { value: "new",             label: "New",             color: "#ffffff", bg: "#64748b33" },
  { value: "contacted",      label: "Contacted",       color: "#60a5fa", bg: "#2563eb22" },
  { value: "interested",      label: "Interested",      color: "#4ade80", bg: "#16a34a22" },
  { value: "callback",        label: "Callback",        color: "#fbbf24", bg: "#d9770622" },
  { value: "appointment_set", label: "Appointment Set", color: "#2dd4bf", bg: "#0d948822" },
  { value: "not_interested",  label: "Not Interested",  color: "#f87171", bg: "#dc262622" },
  { value: "do_not_call",     label: "Do Not Call",     color: "#c084fc", bg: "#7c3aed22" },
  // ── Scalbl.io sales-pipeline stages ──
  { value: "upcoming",        label: "Upcoming",        color: "#38bdf8", bg: "#0ea5e922" },
  { value: "show",            label: "Show",            color: "#4ade80", bg: "#16a34a22" },
  { value: "no_show",         label: "No Show",         color: "#f87171", bg: "#dc262622" },
  { value: "not_booked",      label: "Not Booked",      color: "#94a3b8", bg: "#64748b22" },
  { value: "won",             label: "Won",             color: "#22c55e", bg: "#15803d22" },
  { value: "lost",            label: "Lost",            color: "#f87171", bg: "#b91c1c22" },
  { value: "pending",         label: "Pending",         color: "#fbbf24", bg: "#f59e0b22" },
];

const KANBAN_PAGE = 20;

function KanbanCard({ contact, onOpenConvo, isDragOverlay = false }: { contact: Contact; onOpenConvo: (c: Contact) => void; isDragOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: String(contact.id) });
  const sm = getStatusMeta((contact as any).status);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`rounded-xl border bg-card flex flex-col gap-3 p-4 group transition-all cursor-grab active:cursor-grabbing overflow-hidden ${
        isDragging && !isDragOverlay ? "opacity-30 border-dashed" : "border-border hover:border-primary/40 hover:shadow-md"
      } ${isDragOverlay ? "shadow-2xl rotate-1 scale-105" : ""}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            {((contact.name || contact.phone) ?? "").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight truncate">{contact.name || contact.phone}</p>
            {contact.name && <p className="text-[11px] font-mono text-muted-foreground truncate">{contact.phone}</p>}
          </div>
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onOpenConvo(contact); }}
          title="Open conversation"
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100"
        >
          <MessageSquare size={14} />
        </button>
      </div>
      {/* Email */}
      {(contact as any).email && (
        <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <Mail size={11} className="shrink-0" />{(contact as any).email}
        </p>
      )}
      {/* Company */}
      {(contact as any).company && (
        <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <Building2 size={11} className="shrink-0" />{(contact as any).company}
        </p>
      )}
      {/* Sales pipeline: price quoted + closer */}
      {((contact as any).priceQuoted || (contact as any).closer) && (
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          {(contact as any).priceQuoted && (
            <span className="px-1.5 py-0.5 rounded bg-muted/60 font-medium text-foreground">${(contact as any).priceQuoted}</span>
          )}
          {(contact as any).closer && (
            <span className="truncate">by {(contact as any).closer}</span>
          )}
        </div>
      )}
      {/* Stage + deal-result badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {sm && (
          <span
            className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: sm.bg, color: sm.color }}
          >
            {sm.label}
          </span>
        )}
        {getDealResultMeta((contact as any).dealResult) && (
          <span
            className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: getDealResultMeta((contact as any).dealResult)!.bg, color: getDealResultMeta((contact as any).dealResult)!.color }}
          >
            {getDealResultMeta((contact as any).dealResult)!.label}
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage, cards, onOpenConvo,
}: {
  stage: typeof KANBAN_STAGES[number];
  cards: Contact[];
  onOpenConvo: (c: Contact) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value ?? "__none__" });
  const [visibleCount, setVisibleCount] = useState(KANBAN_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset visible count when cards change (e.g. filter change)
  useEffect(() => { setVisibleCount(KANBAN_PAGE); }, [cards.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      setVisibleCount(v => Math.min(v + KANBAN_PAGE, cards.length));
    }
  };

  const visible = cards.slice(0, visibleCount);

  return (
    <div
      className={`flex flex-col rounded-xl border shrink-0 transition-colors ${
        isOver ? "border-primary/60 bg-primary/5" : "border-border bg-muted/20"
      }`}
      style={{ width: 280 }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
        <span className="text-sm font-semibold text-foreground flex-1">{stage.label}</span>
        <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{cards.length}</span>
      </div>
      {/* Cards */}
      <div
        ref={(el) => { setNodeRef(el); (scrollRef as any).current = el; }}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 flex flex-col gap-3"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", minHeight: 120 }}
      >
        {cards.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-8 gap-2 rounded-lg border-2 border-dashed transition-colors ${
            isOver ? "border-primary/40 bg-primary/5" : "border-border/40"
          }`}>
            <p className="text-xs text-muted-foreground/50">Drop here</p>
          </div>
        )}
        {visible.map((c) => (
          <KanbanCard key={c.id} contact={c} onOpenConvo={onOpenConvo} />
        ))}
        {visibleCount < cards.length && (
          <p className="text-center text-[11px] text-muted-foreground/50 py-2">
            {cards.length - visibleCount} more — scroll to load
          </p>
        )}
      </div>
    </div>
  );
}

function ContactsKanban({
  contacts,
  onOpenConvo,
  onStatusChange,
}: {
  contacts: Contact[];
  onOpenConvo: (c: Contact) => void;
  onStatusChange: (contactId: number, status: string | null) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeContact = activeId ? contacts.find(c => String(c.id) === activeId) ?? null : null;

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const contactId = Number(active.id);
    const newStatus = over.id === "__none__" ? null : String(over.id);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    const currentStatus = (contact as any).status ?? null;
    if (currentStatus === newStatus) return;
    onStatusChange(contactId, newStatus);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 overflow-x-auto overflow-y-hidden" style={{ minHeight: 0 }}>
        <div className="flex gap-4 h-full px-4 py-4" style={{ minWidth: `${KANBAN_STAGES.length * 296}px` }}>
          {KANBAN_STAGES.map((stage) => {
            const cards = contacts.filter((c) => ((c as any).status ?? null) === stage.value);
            return (
              <KanbanColumn
                key={stage.value ?? "__none__"}
                stage={stage}
                cards={cards}
                onOpenConvo={onOpenConvo}
              />
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {activeContact ? (
          <KanbanCard contact={activeContact} onOpenConvo={onOpenConvo} isDragOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
