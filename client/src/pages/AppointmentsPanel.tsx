import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Pencil, X, Clock, ChevronDown, Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── App-level timezone (Adelaide) ───────────────────────────────────────────
const APP_TIMEZONE = "Australia/Adelaide";

/** Convert a wall-clock date+time string (YYYY-MM-DD, HH:MM) in APP_TIMEZONE to a UTC epoch ms */
function wallClockToUtc(dateStr: string, timeStr: string, tz: string): number {
  const isoLocal = `${dateStr}T${timeStr}:00`;
  try {
    const naive = new Date(isoLocal).getTime();
    const tzStr = new Date(naive).toLocaleString("en-US", { timeZone: tz });
    const utcStr = new Date(naive).toLocaleString("en-US", { timeZone: "UTC" });
    const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
    return naive + offsetMs;
  } catch {
    return new Date(isoLocal).getTime();
  }
}

/** Get today's date string in APP_TIMEZONE (YYYY-MM-DD) */
function todayInAppTz(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Calendar = { id: number; name: string; type: string; ownerId: number | null; color: string; createdAt: Date };
type Appointment = { id: number; calendarId: number; contactId: number | null; title: string; startAt: number; endAt: number; notes: string | null; status: string; createdAt: Date; updatedAt: Date; contactName?: string | null; contactPhone?: string | null };
type Contact = { id: number; name: string; phone: string; email: string | null };
type CalView = "day" | "week" | "month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function pad(n: number) { return String(n).padStart(2, "0"); }
function startOfDay(ms: number) { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); }
function startOfWeek(ms: number) { const d = new Date(ms); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }
function addDays(ms: number, n: number) { return ms + n * 86400000; }

function fmtHour(h: number) {
  if (h === 0) return "12AM";
  if (h < 12) return `${h}AM`;
  if (h === 12) return "12PM";
  return `${h - 12}PM`;
}
function fmtTimeRange(startMs: number, endMs: number) {
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${fmt(startMs)} – ${fmt(endMs)}`;
}
function fmtDateHeader(ms: number) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function fmtWeekRange(startMs: number) {
  const end = addDays(startMs, 6);
  const s = new Date(startMs);
  const e = new Date(end);
  return `${MONTH_NAMES[s.getMonth()].slice(0,3)} ${s.getDate()} – ${s.getMonth() !== e.getMonth() ? MONTH_NAMES[e.getMonth()].slice(0,3) + " " : ""}${e.getDate()}, ${e.getFullYear()}`;
}
function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}
function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30",
  completed:  "bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30",
  cancelled:  "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30",
  no_show:    "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30",
};
const PRESET_COLORS = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#06b6d4"];

// ─── Time Grid (shared by Day + Week) ────────────────────────────────────────

const HOUR_HEIGHT = 64; // px per hour

type TimeGridProps = {
  days: number[]; // array of day-start timestamps
  appointments: Appointment[];
  calendars: Calendar[];
  visibleIds: Set<number>;
  onSlotClick: (date: Date) => void;
  onApptClick: (a: Appointment) => void;
};

function TimeGrid({ days, appointments, calendars, visibleIds, onSlotClick, onApptClick }: TimeGridProps) {
  const calMap = useMemo(() => { const m: Record<number, Calendar> = {}; calendars.forEach(c => { m[c.id] = c; }); return m; }, [calendars]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowPct, setNowPct] = useState<number | null>(null);

  // Scroll to current time on mount
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const pct = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
      setNowPct(pct);
    };
    update();
    const id = setInterval(update, 60000);
    if (scrollRef.current) {
      const now = new Date();
      const scrollTo = (now.getHours() - 1) * HOUR_HEIGHT;
      scrollRef.current.scrollTop = Math.max(0, scrollTo);
    }
    return () => clearInterval(id);
  }, []);

  // Group appointments by day
  const apptsByDay = useMemo(() => {
    const map: Record<number, Appointment[]> = {};
    days.forEach(d => { map[d] = []; });
    appointments.forEach(a => {
      if (!visibleIds.has(a.calendarId)) return;
      const dayStart = startOfDay(a.startAt);
      if (map[dayStart] !== undefined) map[dayStart].push(a);
    });
    return map;
  }, [appointments, visibleIds, days]);

  const today = startOfDay(Date.now());
  const isMultiDay = days.length > 1;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day column headers */}
      <div className="flex border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
        <div className="w-16 shrink-0 border-r border-border/50 py-2">
          <div className="text-[10px] text-muted-foreground text-center">
            GMT<br />{new Date().toLocaleTimeString([],{timeZoneName:"short"}).split(" ").pop()?.replace("GMT","") ?? ""}
          </div>
        </div>
        {days.map(d => {
          const date = new Date(d);
          const isToday = d === today;
          return (
            <div key={d} className="flex-1 text-center py-2 border-r border-border/30 last:border-r-0">
              {isMultiDay ? (
                <div className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                  {date.getDate()} {DAY_NAMES_SHORT[date.getDay()]}
                </div>
              ) : (
                <div className={`text-sm font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
                  {DAY_NAMES_SHORT[date.getDay()]}, {MONTH_NAMES[date.getMonth()].slice(0,3)} {date.getDate()}, {date.getFullYear()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* All Day row */}
      <div className="flex border-b border-border shrink-0">
        <div className="w-16 shrink-0 border-r border-border/50 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">All Day</span>
        </div>
        {days.map(d => (
          <div key={d} className="flex-1 min-h-[28px] border-r border-border/30 last:border-r-0" />
        ))}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <div className="flex" style={{ height: HOUR_HEIGHT * 24 }}>
          {/* Time labels */}
          <div className="w-16 shrink-0 border-r border-border/50 relative">
            {HOURS.map(h => (
              <div key={h} className="absolute w-full flex items-start justify-end pr-2" style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
                {h > 0 && <span className="text-[10px] text-muted-foreground -translate-y-2">{fmtHour(h)}</span>}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(d => {
            const isToday = d === today;
            const dayAppts = apptsByDay[d] ?? [];
            return (
              <div
                key={d}
                className="flex-1 relative border-r border-border/30 last:border-r-0 cursor-pointer"
                onClick={e => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const totalMins = Math.floor((y / (HOUR_HEIGHT * 24)) * 24 * 60);
                  const h = Math.floor(totalMins / 60);
                  const min = Math.round((totalMins % 60) / 15) * 15;
                  const clickDate = new Date(d);
                  clickDate.setHours(h, min, 0, 0);
                  onSlotClick(clickDate);
                }}
              >
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="absolute w-full border-t border-border/30" style={{ top: h * HOUR_HEIGHT }} />
                ))}
                {/* Half-hour lines */}
                {HOURS.map(h => (
                  <div key={`h${h}`} className="absolute w-full border-t border-border/10" style={{ top: h * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                ))}

                {/* Current time indicator */}
                {isToday && nowPct !== null && (
                  <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowPct * HOUR_HEIGHT * 24 }}>
                    <div className="relative flex items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 shrink-0" />
                      <div className="flex-1 h-px bg-red-500" />
                    </div>
                  </div>
                )}

                {/* Appointment blocks */}
                {dayAppts.map(a => {
                  const cal = calMap[a.calendarId];
                  const color = cal?.color ?? "#6366f1";
                  const startMins = new Date(a.startAt).getHours() * 60 + new Date(a.startAt).getMinutes();
                  const endMins = new Date(a.endAt).getHours() * 60 + new Date(a.endAt).getMinutes();
                  const top = (startMins / 60) * HOUR_HEIGHT;
                  const height = Math.max(((endMins - startMins) / 60) * HOUR_HEIGHT, 20);
                  return (
                    <button
                      key={a.id}
                      className="absolute left-0.5 right-0.5 rounded text-left px-1.5 pt-1 pb-0.5 text-xs font-medium overflow-hidden hover:opacity-90 transition-opacity z-10 flex flex-col justify-start items-start"
                      style={{ top, height, background: color + "cc", color: "#fff", borderLeft: `3px solid ${color}` }}
                      onClick={e => { e.stopPropagation(); onApptClick(a); }}
                    >
                      <div className="font-semibold truncate leading-tight w-full">{a.title}</div>
                      {height > 28 && (
                        <div className="opacity-80 text-[10px] truncate w-full">{fmtTimeRange(a.startAt, a.endAt)}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Month Grid ───────────────────────────────────────────────────────────────

type MonthGridProps = {
  year: number; month: number;
  appointments: Appointment[]; calendars: Calendar[]; visibleIds: Set<number>;
  onDayClick: (date: Date) => void; onApptClick: (a: Appointment) => void;
};

function MonthGrid({ year, month, appointments, calendars, visibleIds, onDayClick, onApptClick }: MonthGridProps) {
  const calMap = useMemo(() => { const m: Record<number, Calendar> = {}; calendars.forEach(c => { m[c.id] = c; }); return m; }, [calendars]);
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = startOfDay(Date.now());

  const apptsByDay = useMemo(() => {
    const map: Record<number, Appointment[]> = {};
    appointments.forEach(a => {
      if (!visibleIds.has(a.calendarId)) return;
      const key = startOfDay(a.startAt);
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [appointments, visibleIds]);

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 border-b border-border bg-muted/20 sticky top-0 z-10">
        {DAY_NAMES_SHORT.map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground py-2.5 font-semibold tracking-wide border-r border-border/30 last:border-r-0">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="border-b border-r border-border/30 min-h-[120px] bg-muted/5" />;
          const cellTs = new Date(year, month, day).getTime();
          const isToday = cellTs === today;
          const dayAppts = apptsByDay[cellTs] ?? [];
          return (
            <div
              key={i}
              className="border-b border-r border-border/30 min-h-[120px] p-1.5 cursor-pointer hover:bg-accent/40 transition-colors"
              onClick={() => onDayClick(new Date(year, month, day))}
            >
              <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                {day}
              </div>
              <div className="space-y-0.5">
                {dayAppts.slice(0, 4).map(a => {
                  const cal = calMap[a.calendarId];
                  const color = cal?.color ?? "#6366f1";
                  return (
                    <button
                      key={a.id}
                      className="w-full text-left text-[11px] rounded px-1.5 py-0.5 truncate font-medium hover:opacity-80 transition-opacity"
                      style={{ background: color + "cc", color: "#fff" }}
                      onClick={e => { e.stopPropagation(); onApptClick(a); }}
                    >
                      {a.title}
                    </button>
                  );
                })}
                {dayAppts.length > 4 && (
                  <div className="text-[10px] text-muted-foreground pl-1">+{dayAppts.length - 4} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

type ListViewProps = {
  appointments: Appointment[]; calendars: Calendar[]; visibleIds: Set<number>;
  onEdit: (a: Appointment) => void; onDelete: (id: number) => void;
};

function ListView({ appointments, calendars, visibleIds, onEdit, onDelete }: ListViewProps) {
  const calMap = useMemo(() => { const m: Record<number, Calendar> = {}; calendars.forEach(c => { m[c.id] = c; }); return m; }, [calendars]);
  const visible = appointments.filter(a => visibleIds.has(a.calendarId)).sort((a, b) => a.startAt - b.startAt);

  if (visible.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">No appointments found.</p>
        <p className="text-xs opacity-60">Click "Book" to schedule your first appointment.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background/95 backdrop-blur-sm z-10">
          <tr className="border-b border-border text-muted-foreground text-xs">
            <th className="text-left py-3 px-5 font-semibold">Name / Title</th>
            <th className="text-left py-3 px-5 font-semibold">Date &amp; Time</th>
            <th className="text-left py-3 px-5 font-semibold">Calendar</th>
            <th className="text-left py-3 px-5 font-semibold">Status</th>
            <th className="text-left py-3 px-5 font-semibold">Created</th>
            <th className="py-3 px-5" />
          </tr>
        </thead>
        <tbody>
          {visible.map(a => {
            const cal = calMap[a.calendarId];
            return (
              <tr key={a.id} className="border-b border-border/50 hover:bg-accent/40 transition-colors group">
                <td className="py-3 px-5 font-medium text-foreground">{a.title}</td>
                <td className="py-3 px-5 text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{fmtDateTime(a.startAt)}</span>
                  </div>
                </td>
                <td className="py-3 px-5">
                  {cal ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cal.color }} />
                      <span className="text-foreground">{cal.name}</span>
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-3 px-5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[a.status] ?? "bg-muted text-muted-foreground"}`}>
                    {a.status.replace("_"," ")}
                  </span>
                </td>
                <td className="py-3 px-5 text-muted-foreground text-xs">{fmtDate(new Date(a.createdAt).getTime())}</td>
                <td className="py-3 px-5">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(a)} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onDelete(a.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

// ─── Booking Dialog ───────────────────────────────────────────────────────────

type BookingDialogProps = {
  open: boolean; onClose: () => void; calendars: Calendar[];
  defaultDate?: Date; defaultTime?: string; editAppointment?: Appointment | null;
  onSaved: () => void; onDelete?: (id: number) => void;
};

function BookingDialog({ open, onClose, calendars, defaultDate, defaultTime, editAppointment, onSaved, onDelete }: BookingDialogProps) {
  const utils = trpc.useUtils();
  const isEdit = !!editAppointment;
  const toDateInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const toTimeInput = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  const [title, setTitle] = useState(editAppointment?.title ?? "");
  const [calendarId, setCalendarId] = useState<string>(editAppointment ? String(editAppointment.calendarId) : (calendars[0] ? String(calendars[0].id) : ""));
  const [dateStr, setDateStr] = useState(editAppointment ? toDateInput(editAppointment.startAt) : toDateInput((defaultDate ?? new Date()).getTime()));
  const [timeStr, setTimeStr] = useState(editAppointment ? toTimeInput(editAppointment.startAt) : (defaultTime ?? "09:00"));
  const [durationMins, setDurationMins] = useState(editAppointment ? Math.round((editAppointment.endAt - editAppointment.startAt) / 60000) : 60);
  const [notes, setNotes] = useState(editAppointment?.notes ?? "");
  const [status, setStatus] = useState(editAppointment?.status ?? "scheduled");
  const [timezone, setTimezone] = useState((editAppointment as Appointment & { timezone?: string })?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<number | null>(editAppointment?.contactId ?? null);

  // Load contacts directly inside dialog — bypasses tag-permission gate
  const contactSearchQuery = trpc.contacts.search.useQuery(
    { q: contactSearch || undefined },
    { enabled: open }
  );
  const contacts: Contact[] = (contactSearchQuery.data as Contact[] | undefined) ?? [];

  useEffect(() => {
    if (open && !isEdit) {
      setTitle(""); setCalendarId(calendars[0] ? String(calendars[0].id) : "");
      setDateStr(toDateInput((defaultDate ?? new Date()).getTime()));
      setTimeStr(defaultTime ?? "09:00"); setDurationMins(60); setNotes(""); setStatus("scheduled");
      setContactSearch(""); setSelectedContactId(null);
    }
  }, [open]);

  const [contactDropOpen, setContactDropOpen] = useState(false);

  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts.slice(0, 20);
    const q = contactSearch.toLowerCase();
    return contacts.filter(c =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    ).slice(0, 20);
  }, [contacts, contactSearch]);

  const selectedContact = contacts.find(c => c.id === selectedContactId);

  const createMutation = trpc.appointments.create.useMutation({
    onSuccess: () => { utils.appointments.list.invalidate(); onSaved(); onClose(); toast.success("Appointment booked"); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.appointments.update.useMutation({
    onSuccess: () => { utils.appointments.list.invalidate(); onSaved(); onClose(); toast.success("Appointment updated"); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!calendarId) { toast.error("Please select a calendar"); return; }
    // Parse date+time in the selected timezone (not browser local time)
    // We use Intl to find the UTC offset for the chosen tz at the given wall-clock time
    const isoLocal = `${dateStr}T${timeStr}:00`;
    let startAt: number;
    try {
      // Parse the wall-clock time in the selected timezone by computing the UTC offset.
      // Strategy: format the naive timestamp in both the target tz and UTC, compare the difference.
      const naive = new Date(isoLocal).getTime(); // browser-local interpretation
      const tzStr = new Date(naive).toLocaleString("en-US", { timeZone: timezone });
      const utcStr = new Date(naive).toLocaleString("en-US", { timeZone: "UTC" });
      const tzDate = new Date(tzStr);
      const utcDate = new Date(utcStr);
      const offsetMs = utcDate.getTime() - tzDate.getTime();
      startAt = naive + offsetMs;
    } catch {
      // Fallback to browser local if timezone parse fails
      const [y, mo, d] = dateStr.split("-").map(Number);
      const [h, min] = timeStr.split(":").map(Number);
      startAt = new Date(y, mo-1, d, h, min).getTime();
    }
    const endAt = startAt + durationMins * 60000;
    const payload = { calendarId: Number(calendarId), contactId: selectedContactId ?? undefined, title: title.trim(), startAt, endAt, notes: notes || undefined, status, timezone };
    if (isEdit && editAppointment) updateMutation.mutate({ id: editAppointment.id, ...payload });
    else createMutation.mutate(payload);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg bg-background border-border text-foreground">
        <DialogHeader><DialogTitle className="text-foreground">{isEdit ? "Edit Appointment" : "Book Appointment"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Title *</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. John Smith — Discovery Call" className="bg-background border-border text-foreground placeholder:text-muted-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Link to Contact (optional)</label>
            {selectedContact ? (
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted border border-border">
                <span className="flex-1 text-sm text-foreground">{selectedContact.name} — {selectedContact.phone}</span>
                <button onClick={() => { setSelectedContactId(null); setContactSearch(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={contactSearch}
                  onChange={e => { setContactSearch(e.target.value); setContactDropOpen(true); }}
                  onFocus={() => setContactDropOpen(true)}
                  onBlur={() => setTimeout(() => setContactDropOpen(false), 150)}
                  placeholder="Search by name, phone, or email..."
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                />
                {contactDropOpen && filteredContacts.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-xl max-h-48 overflow-y-auto">
                    {filteredContacts.map(c => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 text-popover-foreground"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setSelectedContactId(c.id);
                          setTitle(c.name);
                          setContactSearch("");
                          setContactDropOpen(false);
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground text-xs">{c.phone}</span>
                        {c.email && <span className="text-muted-foreground text-xs ml-auto">{c.email}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {contactDropOpen && contacts.length === 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-xl px-3 py-2 text-sm text-muted-foreground">
                    No contacts found
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Calendar *</label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger className="bg-background border-border text-foreground"><SelectValue placeholder="Select calendar" /></SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {calendars.map(cal => (
                  <SelectItem key={cal.id} value={String(cal.id)} className="text-popover-foreground">
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: cal.color }} />{cal.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground mb-1.5 block font-medium">Date *</label><Input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="bg-background border-border text-foreground" /></div>
            <div><label className="text-xs text-muted-foreground mb-1.5 block font-medium">Time *</label><Input type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)} className="bg-background border-border text-foreground" /></div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Duration</label>
            <Select value={String(durationMins)} onValueChange={v => setDurationMins(Number(v))}>
              <SelectTrigger className="bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {[15,30,45,60,90,120].map(m => <SelectItem key={m} value={String(m)} className="text-popover-foreground">{m < 60 ? `${m} min` : `${m/60} hr${m > 60 ? "s" : ""}`}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Timezone</label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border-border max-h-64 overflow-y-auto">
                {[
                  "Pacific/Honolulu","America/Anchorage","America/Los_Angeles","America/Denver",
                  "America/Chicago","America/New_York","America/Sao_Paulo","Europe/London",
                  "Europe/Paris","Europe/Berlin","Europe/Moscow","Asia/Dubai","Asia/Kolkata",
                  "Asia/Bangkok","Asia/Singapore","Asia/Tokyo","Asia/Seoul","Australia/Perth",
                  "Australia/Adelaide","Australia/Sydney","Pacific/Auckland",
                ].map(tz => (
                  <SelectItem key={tz} value={tz} className="text-popover-foreground text-xs">{tz.replace(/_/g," ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isEdit && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-background border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {["scheduled","completed","cancelled","no_show"].map(s => <SelectItem key={s} value={s} className="text-popover-foreground capitalize">{s.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Notes</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." className="bg-background border-border text-foreground placeholder:text-muted-foreground resize-none" rows={3} />
          </div>
        </div>
        <DialogFooter>
          {isEdit && onDelete && editAppointment && (
            <Button
              variant="outline"
              className="mr-auto text-destructive border-destructive/40 hover:bg-destructive/10"
              disabled={isPending}
              onClick={() => {
                if (!confirm(`Delete "${editAppointment.title}"?`)) return;
                onDelete(editAppointment.id);
                onClose();
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={isPending} className="text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button onClick={handleSave} disabled={isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">{isPending ? "Saving..." : (isEdit ? "Update" : "Book")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Quick Book Bar ──────────────────────────────────────────────────────────

type QuickBookBarProps = {
  calendars: Calendar[];
  onBooked: () => void;
};

function QuickBookBar({ calendars, onBooked }: QuickBookBarProps) {
  const utils = trpc.useUtils();

  // Contact autocomplete
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactDropOpen, setContactDropOpen] = useState(false);
  const contactRef = useRef<HTMLDivElement>(null);

  const contactSearchQuery = trpc.contacts.search.useQuery(
    { q: contactSearch || undefined },
    { enabled: true, staleTime: 10000 }
  );
  const allContacts: Contact[] = (contactSearchQuery.data as Contact[] | undefined) ?? [];
  const filteredContacts = useMemo(() => {
    if (!contactSearch) return allContacts.slice(0, 20);
    const q = contactSearch.toLowerCase();
    return allContacts.filter(c =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q)
    ).slice(0, 20);
  }, [allContacts, contactSearch]);

  // Date + time (defaults to today in Adelaide, next hour)
  const [dateStr, setDateStr] = useState(() => todayInAppTz());
  const [timeStr, setTimeStr] = useState(() => {
    const now = new Date();
    const h = (now.getHours() + 1) % 24;
    return `${String(h).padStart(2, "0")}:00`;
  });

  // Calendar
  const [calendarId, setCalendarId] = useState<string>("");
  useEffect(() => {
    if (calendars.length > 0 && !calendarId) setCalendarId(String(calendars[0].id));
  }, [calendars.length]);

  // Duration
  const [durationMins, setDurationMins] = useState(30);

  const DURATIONS = [15, 30, 45, 60, 90, 120];

  const createMutation = trpc.appointments.create.useMutation({
    onSuccess: () => {
      utils.appointments.list.invalidate();
      onBooked();
      toast.success("Appointment booked!");
      // Reset
      setSelectedContact(null);
      setContactSearch("");
      setDateStr(todayInAppTz());
      const now = new Date();
      const h = (now.getHours() + 1) % 24;
      setTimeStr(`${String(h).padStart(2, "0")}:00`);
      setDurationMins(30);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleBook = () => {
    if (!selectedContact) { toast.error("Please select a contact"); return; }
    if (!calendarId) { toast.error("Please select a calendar"); return; }
    if (!dateStr || !timeStr) { toast.error("Please enter a date and time"); return; }
    const startAt = wallClockToUtc(dateStr, timeStr, APP_TIMEZONE);
    const endAt = startAt + durationMins * 60000;
    const title = `${selectedContact.name} — Call`;
    createMutation.mutate({
      calendarId: Number(calendarId),
      contactId: selectedContact.id,
      title,
      startAt,
      endAt,
      timezone: APP_TIMEZONE,
      status: "scheduled",
    });
  };

  // Close contact dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contactRef.current && !contactRef.current.contains(e.target as Node)) {
        setContactDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0">
      <div className="flex items-center gap-1.5 mb-2">
        <Zap size={13} className="text-primary" />
        <span className="text-xs font-semibold text-foreground">Quick Book</span>
        <span className="text-[10px] text-muted-foreground ml-1">Time is in Adelaide (ACST)</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Contact picker */}
        <div ref={contactRef} className="relative">
          {selectedContact ? (
            <div className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary/10 border border-primary/30 text-sm text-foreground">
              <span className="font-medium">{selectedContact.name}</span>
              <button onClick={() => { setSelectedContact(null); setContactSearch(""); }} className="text-muted-foreground hover:text-foreground ml-1">
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input
                value={contactSearch}
                onChange={e => { setContactSearch(e.target.value); setContactDropOpen(true); }}
                onFocus={() => setContactDropOpen(true)}
                placeholder="Contact name…"
                className="h-8 w-44 text-sm bg-background border-border placeholder:text-muted-foreground"
              />
              {contactDropOpen && filteredContacts.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-md shadow-xl z-50 max-h-48 overflow-y-auto">
                  {filteredContacts.map(c => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onClick={() => { setSelectedContact(c); setContactSearch(""); setContactDropOpen(false); }}
                    >
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date */}
        <span className="text-xs text-muted-foreground">at</span>
        <Input
          type="date"
          value={dateStr}
          onChange={e => setDateStr(e.target.value)}
          className="h-8 w-36 text-sm bg-background border-border text-foreground"
        />

        {/* Time */}
        <Input
          type="time"
          value={timeStr}
          onChange={e => setTimeStr(e.target.value)}
          className="h-8 w-28 text-sm bg-background border-border text-foreground"
        />

        {/* Calendar */}
        <span className="text-xs text-muted-foreground">in</span>
        <Select value={calendarId} onValueChange={setCalendarId}>
          <SelectTrigger className="h-8 w-44 text-sm bg-background border-border text-foreground">
            <SelectValue placeholder="Calendar…" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border text-popover-foreground">
            {calendars.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Duration */}
        <span className="text-xs text-muted-foreground">for</span>
        <Select value={String(durationMins)} onValueChange={v => setDurationMins(Number(v))}>
          <SelectTrigger className="h-8 w-28 text-sm bg-background border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border text-popover-foreground">
            {DURATIONS.map(d => (
              <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Book button */}
        <Button
          size="sm"
          className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 ml-1"
          onClick={handleBook}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "Booking…" : "Book"}
        </Button>
      </div>
    </div>
  );
}

// ─── Add Calendar Dialog ──────────────────────────────────────────────────────

function AddCalendarDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const createMutation = trpc.calendars.create.useMutation({
    onSuccess: () => { utils.calendars.list.invalidate(); onSaved(); onClose(); setName(""); toast.success("Calendar created"); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm bg-background border-border text-foreground">
        <DialogHeader><DialogTitle className="text-foreground">New Calendar</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><label className="text-xs text-muted-foreground mb-1.5 block font-medium">Calendar Name *</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Harborview Bookings" className="bg-background border-border text-foreground placeholder:text-muted-foreground" /></div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} className="w-7 h-7 rounded-full border-2 transition-all" style={{ background: c, borderColor: color === c ? "white" : "transparent", outline: color === c ? `2px solid ${c}` : "none", outlineOffset: "2px" }} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button onClick={() => createMutation.mutate({ name, type: "custom", color })} disabled={!name.trim() || createMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">{createMutation.isPending ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Calendar Sidebar ─────────────────────────────────────────────────────────

function CalendarSidebar({ calendars, visibleIds, onToggle, onAddCalendar, onDeleteCalendar }: {
  calendars: Calendar[]; visibleIds: Set<number>;
  onToggle: (id: number) => void; onAddCalendar: () => void; onDeleteCalendar: (id: number) => void;
}) {
  const Section = ({ title, cals }: { title: string; cals: Calendar[] }) => (
    <div className="mb-5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-2 px-1 font-semibold">{title}</div>
      {cals.length === 0 && <div className="text-xs text-muted-foreground/50 px-1 italic">None</div>}
      {cals.map(cal => (
        <div key={cal.id} className="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-accent group cursor-pointer">
          <button onClick={() => onToggle(cal.id)} className="flex items-center gap-2 flex-1 text-left">
            <span className="w-3 h-3 rounded-sm border-2 flex-shrink-0 transition-all" style={{ background: visibleIds.has(cal.id) ? cal.color : "transparent", borderColor: cal.color }} />
            <span className="text-sm text-foreground truncate">{cal.name}</span>
          </button>
          {cal.type === "custom" && (
            <button onClick={() => onDeleteCalendar(cal.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <div className="w-52 flex-shrink-0 border-l border-border flex flex-col bg-background/50 p-4 overflow-y-auto">
      <Section title="My Calendars" cals={calendars.filter(c => c.type === "user")} />
      <Section title="Other Calendars" cals={calendars.filter(c => c.type === "custom")} />
      <Button variant="outline" size="sm" className="mt-1 border-border text-foreground hover:bg-accent text-xs" onClick={onAddCalendar}>
        <Plus className="w-3.5 h-3.5 mr-1" /> New Calendar
      </Button>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function AppointmentsPanel() {
  const utils = trpc.useUtils();
  const [calView, setCalView] = useState<CalView>("week");
  const [listView, setListView] = useState(false);
  const [viewDropOpen, setViewDropOpen] = useState(false);
  const [cursor, setCursor] = useState(() => startOfDay(Date.now())); // anchor date
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDate, setBookingDate] = useState<Date | undefined>();
  const [bookingTime, setBookingTime] = useState<string | undefined>();
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [addCalOpen, setAddCalOpen] = useState(false);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());

  const calendarsQuery = trpc.calendars.list.useQuery();
  const calendars: Calendar[] = (calendarsQuery.data as Calendar[] | undefined) ?? [];

  useEffect(() => {
    if (calendars.length > 0 && visibleIds.size === 0) setVisibleIds(new Set(calendars.map(c => c.id)));
  }, [calendars.length]);

  // Compute date range for query
  const { rangeFrom, rangeTo, days, headerLabel } = useMemo(() => {
    if (calView === "day") {
      const d = startOfDay(cursor);
      return { rangeFrom: d - 86400000, rangeTo: d + 2 * 86400000, days: [d], headerLabel: fmtDateHeader(d) };
    }
    if (calView === "week") {
      const w = startOfWeek(cursor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
      return { rangeFrom: w - 86400000, rangeTo: w + 8 * 86400000, days, headerLabel: fmtWeekRange(w) };
    }
    // month
    const d = new Date(cursor);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
    return { rangeFrom: from - 7 * 86400000, rangeTo: to + 7 * 86400000, days: [], headerLabel: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
  }, [calView, cursor]);

  const appointmentsQuery = trpc.appointments.list.useQuery({ from: rangeFrom, to: rangeTo }, { refetchInterval: 30000 });
  const allAppointments: Appointment[] = (appointmentsQuery.data as Appointment[] | undefined) ?? [];

  const contactsQuery = trpc.contacts.list.useQuery({});
  const contacts: Contact[] = (contactsQuery.data as Contact[] | undefined) ?? [];

  const deleteMutation = trpc.appointments.delete.useMutation({
    onSuccess: () => { utils.appointments.list.invalidate(); toast.success("Appointment deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteCalendarMutation = trpc.calendars.delete.useMutation({
    onSuccess: () => { utils.calendars.list.invalidate(); utils.appointments.list.invalidate(); toast.success("Calendar deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const toggleCalendar = useCallback((id: number) => {
    setVisibleIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const navigate = (dir: 1 | -1) => {
    if (calView === "day") setCursor(c => addDays(c, dir));
    else if (calView === "week") setCursor(c => addDays(c, dir * 7));
    else {
      const d = new Date(cursor);
      setCursor(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime());
    }
  };

  const goToday = () => setCursor(startOfDay(Date.now()));

  const handleSlotClick = (date: Date) => {
    setBookingDate(date);
    setBookingTime(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
    setEditAppt(null);
    setBookingOpen(true);
  };

  const handleApptClick = (a: Appointment) => { setEditAppt(a); setBookingOpen(true); };

  const VIEW_LABELS: Record<CalView, string> = { day: "Day View", week: "Week View", month: "Month View" };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ── Header ── */}
      <div className="px-5 py-3 border-b border-border shrink-0 flex items-center gap-3 bg-background/80 backdrop-blur-sm">
        {/* Today + nav */}
        <Button variant="outline" size="sm" className="h-8 text-xs border-border text-foreground hover:bg-accent" onClick={goToday}>Today</Button>
        <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => navigate(1)} className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-foreground min-w-[160px]">{headerLabel}</span>

        <div className="flex-1" />

        {/* View dropdown */}
        <div className="relative">
          <button
            onClick={() => setViewDropOpen(v => !v)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            {listView ? "List View" : VIEW_LABELS[calView]}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          {viewDropOpen && (
            <div className="absolute right-0 mt-1 w-40 bg-popover border border-border rounded-md shadow-xl z-50 py-1">
              {(["day","week","month"] as CalView[]).map(v => (
                <button key={v} className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${!listView && calView === v ? "text-primary font-medium" : "text-popover-foreground"}`}
                  onClick={() => { setCalView(v); setListView(false); setViewDropOpen(false); }}>
                  {VIEW_LABELS[v]}
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <button className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${listView ? "text-primary font-medium" : "text-popover-foreground"}`}
                onClick={() => { setListView(true); setViewDropOpen(false); }}>
                List View
              </button>
            </div>
          )}
        </div>

        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 text-xs"
          onClick={() => { setEditAppt(null); setBookingDate(new Date()); setBookingTime(undefined); setBookingOpen(true); }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Book
        </Button>
      </div>

      {/* ── Quick Book Bar ── */}
      <QuickBookBar calendars={calendars} onBooked={() => utils.appointments.list.invalidate()} />

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden" onClick={() => setViewDropOpen(false)}>
        <div className="flex-1 flex flex-col overflow-hidden">
          {listView ? (
            <ListView
              appointments={allAppointments} calendars={calendars} visibleIds={visibleIds}
              onEdit={a => { setEditAppt(a); setBookingOpen(true); }}
              onDelete={id => deleteMutation.mutate({ id })}
            />
          ) : calView === "month" ? (
            <MonthGrid
              year={new Date(cursor).getFullYear()} month={new Date(cursor).getMonth()}
              appointments={allAppointments} calendars={calendars} visibleIds={visibleIds}
              onDayClick={d => { setCursor(d.getTime()); setCalView("day"); }}
              onApptClick={handleApptClick}
            />
          ) : (
            <TimeGrid
              days={days} appointments={allAppointments} calendars={calendars} visibleIds={visibleIds}
              onSlotClick={handleSlotClick} onApptClick={handleApptClick}
            />
          )}
        </div>

        <CalendarSidebar
          calendars={calendars} visibleIds={visibleIds}
          onToggle={toggleCalendar} onAddCalendar={() => setAddCalOpen(true)}
          onDeleteCalendar={id => deleteCalendarMutation.mutate({ id })}
        />
      </div>

      <BookingDialog
        open={bookingOpen} onClose={() => { setBookingOpen(false); setEditAppt(null); }}
        calendars={calendars} defaultDate={bookingDate} defaultTime={bookingTime}
        editAppointment={editAppt}
        onSaved={() => utils.appointments.list.invalidate()}
        onDelete={id => deleteMutation.mutate({ id })}
      />
      <AddCalendarDialog open={addCalOpen} onClose={() => setAddCalOpen(false)} onSaved={() => {}} />
    </div>
  );
}
