/**
 * Power Dialler
 *
 * Systematically calls through a list of leads one by one with no manual
 * intervention between calls. When a call ends the next lead is dialled
 * automatically. 3-way conference is available during any call.
 *
 * State machine:
 *   idle  →  (upload CSV)  →  ready
 *   ready →  (Start)       →  dialling  (auto-advances on call end)
 *   dialling → (Pause)     →  paused    (finishes current call then stops)
 *   dialling / paused → (Stop) → ready  (clears current call immediately)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Phone, PhoneOff, Upload, Loader2, Play, Pause, Square,
  Users, ChevronRight, UserMinus, PhoneForwarded, LogOut, Pause as PauseIcon, Play as PlayIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { UseTelnyxPhoneReturn, ConferenceParticipant } from "@/hooks/useTelnyxPhone";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PowerLead {
  id: string;
  name: string;
  phone: string;
}

type DiallerStatus = "idle" | "ready" | "dialling" | "paused";

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseLeadsFromCsv(csv: string): PowerLead[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

  const phoneIdx = headers.findIndex((h) =>
    ["phone", "mobile", "number", "cell", "telephone", "ph"].some((k) => h.includes(k))
  );
  const nameIdx = headers.findIndex((h) =>
    ["name", "full", "first", "contact", "client", "customer"].some((k) => h.includes(k))
  );

  if (phoneIdx === -1) return [];

  const leads: PowerLead[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const phone = cols[phoneIdx]?.trim();
    if (!phone) continue;
    const name = nameIdx !== -1 ? (cols[nameIdx]?.trim() || phone) : phone;
    leads.push({ id: `${i}-${phone}`, name, phone });
  }
  return leads;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function useCallTimer(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (active) {
      startRef.current = Date.now() - elapsed * 1000;
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      setElapsed(0);
      startRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return elapsed;
}

// ─── Mini conference panel (same logic as Dialer.tsx ConferencePanel) ─────────

function MiniConferencePanel({
  phone,
  customerPhone,
  customerName,
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

  if (!inConference) {
    return (
      <Button
        onClick={() => run(() => phone.startConference(customerPhone), "Start 3-way")}
        disabled={phone.phoneState !== "active" && phone.phoneState !== "ready" || busy}
        size="sm"
        variant="outline"
        className="gap-1.5 h-8 text-xs"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />}
        3-Way
      </Button>
    );
  }

  const roleLabel = (p: ConferenceParticipant) =>
    p.role === "agent" ? "You"
    : p.role === "customer" ? (customerName || p.number || "Customer")
    : (p.number || "Target");

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2.5 mt-2">
      <div className="space-y-1.5">
        {participants.map((p, i) => (
          <div key={`${p.role}-${i}`} className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? (p.onHold ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40"}`} />
            <span className="flex-1 truncate">{roleLabel(p)}</span>
            <span className="text-muted-foreground">{!p.connected ? "ringing…" : p.onHold ? "on hold" : "live"}</span>
            {p.connected && p.role !== "agent" && (
              <>
                <button onClick={() => run(() => phone.setParticipantHold(p.role as "customer" | "target", !p.onHold), "Hold")} disabled={busy} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                  {p.onHold ? <PlayIcon size={11} /> : <PauseIcon size={11} />}
                </button>
                <button onClick={() => run(() => phone.removeParticipant(p.role as "customer" | "target"), "Remove")} disabled={busy} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                  <UserMinus size={11} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {!hasTarget && (
        <div className="flex items-center gap-1.5">
          <Input value={targetNumber} onChange={(e) => setTargetNumber(e.target.value)} placeholder="Transfer to…" className="h-7 text-xs" />
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Checkbox checked={warm} onCheckedChange={(v) => setWarm(!!v)} className="h-3 w-3" />
            Warm
          </label>
          <Button size="sm" variant="outline" disabled={busy || !targetNumber.trim()} onClick={() => run(async () => { await phone.addTarget(targetNumber.trim(), warm); setTargetNumber(""); }, "Add")} className="h-7 gap-1 shrink-0 text-xs">
            Add
          </Button>
        </div>
      )}

      {hasTarget && anyHeld && (
        <Button size="sm" disabled={busy} onClick={() => run(() => phone.mergeConference(), "Merge")} className="w-full h-7 gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
          <PhoneForwarded size={12} /> Merge everyone
        </Button>
      )}

      <div className="flex gap-2 pt-1 border-t border-border">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => phone.leaveConference(), "Leave")} className="flex-1 h-7 gap-1 text-xs">
          <LogOut size={11} /> Leave
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => phone.endConference(), "End")} className="flex-1 h-7 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/10">
          <PhoneOff size={11} /> End all
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PowerDialler({ phone }: { phone: UseTelnyxPhoneReturn }) {
  const [queue, setQueue]           = useState<PowerLead[]>([]);
  const [called, setCalled]         = useState<PowerLead[]>([]);
  const [status, setStatus]         = useState<DiallerStatus>("idle");
  const [currentLead, setCurrentLead] = useState<PowerLead | null>(null);
  const statusRef                   = useRef<DiallerStatus>("idle");

  const callElapsed = useCallTimer(phone.phoneState === "active");

  // Keep ref in sync so the phoneState effect can read it without stale closure
  const syncStatus = useCallback((s: DiallerStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ── CSV upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csv = ev.target?.result as string;
      const leads = parseLeadsFromCsv(csv);
      if (leads.length === 0) {
        toast.error("No leads found — make sure the CSV has a Phone column");
        return;
      }
      setQueue(leads);
      setCalled([]);
      setCurrentLead(null);
      syncStatus("ready");
      toast.success(`${leads.length} leads loaded`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [syncStatus]);

  // ── Dial helpers ────────────────────────────────────────────────────────────
  const dialLead = useCallback((lead: PowerLead) => {
    if (phone.phoneState !== "ready") {
      toast.error("Phone not ready");
      return;
    }
    setCurrentLead(lead);
    setQueue((q) => q.filter((l) => l.id !== lead.id));
    phone.dial(lead.phone);
  }, [phone]);

  const start = useCallback(() => {
    if (queue.length === 0) { toast.error("No leads in queue"); return; }
    if (!["ready", "idle"].includes(phone.phoneState)) { toast.error("Connect your microphone first"); return; }
    syncStatus("dialling");
    dialLead(queue[0]);
  }, [queue, phone.phoneState, syncStatus, dialLead]);

  const pause = useCallback(() => {
    syncStatus("paused");
    toast("Pausing after this call…");
  }, [syncStatus]);

  const stop = useCallback(() => {
    if (phone.phoneState === "active") phone.hangup();
    if (phone.conferenceToken) void phone.endConference();
    syncStatus("ready");
    setCurrentLead(null);
  }, [phone, syncStatus]);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((q) => q.filter((l) => l.id !== id));
  }, []);

  // ── Auto-advance when a call ends ───────────────────────────────────────────
  const prevPhoneState = useRef(phone.phoneState);
  useEffect(() => {
    const prev = prevPhoneState.current;
    const cur  = phone.phoneState;
    prevPhoneState.current = cur;

    // Detect transition: active → ended (call just finished)
    if (prev === "active" && cur === "ended") {
      if (currentLead) {
        setCalled((c) => [currentLead, ...c]);
        setCurrentLead(null);
      }
    }

    // When phone returns to ready after a call, decide whether to continue
    if (prev === "ended" && cur === "ready") {
      if (statusRef.current === "dialling") {
        setQueue((q) => {
          if (q.length === 0) {
            syncStatus("ready");
            toast.success("All leads called!");
            return q;
          }
          // Schedule the next dial slightly after ready state settles
          const next = q[0];
          setTimeout(() => dialLead(next), 800);
          return q;
        });
      }
    }
  }, [phone.phoneState, currentLead, syncStatus, dialLead]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const callIsActive = ["connecting", "ringing", "active", "reconnecting"].includes(phone.phoneState);
  const remaining = queue.length;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Queue ── */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold">Power Dialler</p>
              <p className="text-xs text-muted-foreground">
                {remaining > 0 ? `${remaining} remaining` : called.length > 0 ? "Queue empty" : "No leads loaded"}
              </p>
            </div>
            <label className="cursor-pointer">
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-all">
                <Upload size={12} /> Upload CSV
              </div>
            </label>
          </div>

          {/* Controls */}
          {status !== "idle" && (
            <div className="flex gap-1.5">
              {status === "ready" && remaining > 0 && (
                <Button size="sm" onClick={start} disabled={!["ready", "idle"].includes(phone.phoneState)} className="flex-1 h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
                  <Play size={12} /> Start Dialling
                </Button>
              )}
              {status === "dialling" && (
                <>
                  <Button size="sm" variant="outline" onClick={pause} className="flex-1 h-8 gap-1 text-xs">
                    <Pause size={12} /> Pause
                  </Button>
                  <Button size="sm" variant="outline" onClick={stop} className="h-8 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/10">
                    <Square size={11} /> Stop
                  </Button>
                </>
              )}
              {status === "paused" && (
                <>
                  <Button size="sm" onClick={start} disabled={!["ready"].includes(phone.phoneState) || remaining === 0} className="flex-1 h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
                    <Play size={12} /> Resume
                  </Button>
                  <Button size="sm" variant="outline" onClick={stop} className="h-8 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/10">
                    <Square size={11} /> Stop
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Queue list */}
        <div className="flex-1 overflow-y-auto">
          {queue.length === 0 && status === "idle" && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Upload size={20} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Upload a CSV to load leads</p>
              <p className="text-xs text-muted-foreground/60">Needs a Phone column. Name column optional.</p>
            </div>
          )}
          {queue.map((lead, i) => (
            <div key={lead.id} className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/50 hover:bg-accent/40 group ${i === 0 && status !== "dialling" ? "bg-primary/5" : ""}`}>
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{lead.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{lead.phone}</p>
              </div>
              <button
                onClick={() => removeFromQueue(lead.id)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                title="Remove from queue"
              >
                <UserMinus size={11} />
              </button>
            </div>
          ))}

          {/* Called leads */}
          {called.length > 0 && (
            <div className="px-4 py-2 border-t border-border/50">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Called ({called.length})</p>
              {called.map((lead) => (
                <div key={lead.id} className="flex items-center gap-2 py-1.5 opacity-40">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Phone size={9} className="text-emerald-600" />
                  </div>
                  <p className="text-xs truncate">{lead.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Current call ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!currentLead && !callIsActive ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Phone size={28} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                {status === "idle" ? "Load leads to get started" : remaining > 0 ? "Ready to dial" : "All leads called"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {status === "idle" ? "Upload a CSV file with phone numbers" :
                 remaining > 0 ? `${remaining} lead${remaining !== 1 ? "s" : ""} in the queue` :
                 "Great work — the queue is empty"}
              </p>
            </div>
            {status === "ready" && remaining > 0 && (
              <Button onClick={start} disabled={!["ready", "idle"].includes(phone.phoneState)} className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white">
                <Play size={14} /> Start Dialling
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Current lead header */}
            <div className="px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                  {(currentLead?.name || "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{currentLead?.name || "Unknown"}</p>
                  <p className="text-sm text-muted-foreground font-mono">{currentLead?.phone}</p>
                </div>
                <div className="shrink-0">
                  {phone.phoneState === "active" && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {formatDuration(callElapsed)}
                    </div>
                  )}
                  {(phone.phoneState === "connecting" || phone.phoneState === "ringing") && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-600 animate-pulse">
                      <Loader2 size={11} className="animate-spin" />
                      {phone.phoneState === "ringing" ? "Ringing…" : "Connecting…"}
                    </div>
                  )}
                  {phone.phoneState === "ended" && (
                    <div className="text-xs text-muted-foreground px-3 py-1.5">Call ended</div>
                  )}
                </div>
              </div>
            </div>

            {/* Call controls */}
            <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
              <div className="flex items-center gap-3">
                {/* Hang up / manual dial */}
                {callIsActive ? (
                  <Button
                    onClick={() => {
                      phone.hangup();
                      if (phone.conferenceToken) void phone.endConference();
                    }}
                    size="sm"
                    className="gap-2 bg-destructive/20 text-destructive border border-destructive/30 hover:bg-destructive/30"
                  >
                    <PhoneOff size={13} /> End call
                  </Button>
                ) : (
                  <Button
                    onClick={() => currentLead && dialLead(currentLead)}
                    disabled={phone.phoneState !== "ready" || !currentLead}
                    size="sm"
                    className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Phone size={13} /> Dial
                  </Button>
                )}

                {/* Mute */}
                {phone.phoneState === "active" && (
                  <Button onClick={phone.toggleMute} size="sm" variant="outline" className={`gap-1.5 ${phone.isMuted ? "border-amber-500/30 bg-amber-500/10 text-amber-600" : ""}`}>
                    {phone.isMuted ? "Unmute" : "Mute"}
                  </Button>
                )}

                {/* Skip */}
                {status === "dialling" && queue.length > 0 && !callIsActive && (
                  <Button
                    onClick={() => {
                      const next = queue[0];
                      if (next) dialLead(next);
                    }}
                    size="sm"
                    variant="outline"
                    className="gap-1.5 ml-auto"
                  >
                    Skip <ChevronRight size={12} />
                  </Button>
                )}
              </div>

              {/* 3-way conference panel */}
              {currentLead && (phone.phoneState === "active" || phone.conferenceToken) && (
                <MiniConferencePanel
                  phone={phone}
                  customerPhone={currentLead.phone}
                  customerName={currentLead.name}
                />
              )}
            </div>

            {/* Next up */}
            {queue.length > 0 && (
              <div className="px-6 py-3 shrink-0">
                <p className="text-xs text-muted-foreground mb-2">Next up</p>
                <div className="space-y-1">
                  {queue.slice(0, 3).map((lead, i) => (
                    <div key={lead.id} className={`flex items-center gap-2 text-xs ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                      <span className="w-4 text-right text-[10px]">{i + 1}.</span>
                      <span className="font-medium truncate">{lead.name}</span>
                      <span className="font-mono ml-auto shrink-0">{lead.phone}</span>
                    </div>
                  ))}
                  {queue.length > 3 && (
                    <p className="text-[10px] text-muted-foreground pl-6">+{queue.length - 3} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
