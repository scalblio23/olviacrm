/**
 * AutomationsPanel — GHL-style automation builder
 * Supports: tag-based trigger, wait steps (delay OR before-event), SMS steps, Email steps
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Zap, Plus, Trash2, ChevronRight, ArrowLeft,
  Clock, MessageSquare, Mail, ToggleLeft, ToggleRight,
  GripVertical, AlertCircle, CheckCircle2, Loader2, Sparkles, Send,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlaceholderPicker } from "@/components/PlaceholderPicker";
import type { Tag as TagType } from "../../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────
type StepType = "wait" | "sms" | "email" | "imessage";
type WaitUnit = "minutes" | "hours" | "days";
type WaitMode = "delay" | "before_event";

interface AutomationStep {
  id?: number;
  stepType: StepType;
  waitValue: number | null;
  waitUnit: WaitUnit | null;
  waitMode: WaitMode | null;
  eventType: string | null;
  smsBody: string | null;
  emailSubject: string | null;
  emailBody: string | null;
}

interface Automation {
  id: number;
  name: string;
  triggerType: string;
  triggerTagId: number | null;
  triggerCalendarId?: number | null;
  isActive: boolean;
  createdAt: Date | number;
  steps?: AutomationStep[];
}

// ─── Step card colours ────────────────────────────────────────────────────────
const STEP_META: Record<StepType, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  wait:     { label: "Wait",     icon: <Clock size={14} />,         color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/30" },
  sms:      { label: "SMS",      icon: <MessageSquare size={14} />, color: "text-sky-400",    bg: "bg-sky-500/10 border-sky-500/30" },
  email:    { label: "Email",    icon: <Mail size={14} />,          color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/30" },
  imessage: { label: "iMessage", icon: <MessageSquare size={14} />, color: "text-green-400",  bg: "bg-green-500/10 border-green-500/30" },
};

// ─── Blank step factories ─────────────────────────────────────────────────────
function blankStep(type: StepType): AutomationStep {
  if (type === "wait")     return { stepType: "wait",     waitValue: 1, waitUnit: "hours", waitMode: "delay", eventType: null, smsBody: null, emailSubject: null, emailBody: null };
  if (type === "sms")      return { stepType: "sms",      waitValue: null, waitUnit: null, waitMode: null, eventType: null, smsBody: "", emailSubject: null, emailBody: null };
  if (type === "imessage") return { stepType: "imessage", waitValue: null, waitUnit: null, waitMode: null, eventType: null, smsBody: "", emailSubject: null, emailBody: null };
  return                          { stepType: "email",    waitValue: null, waitUnit: null, waitMode: null, eventType: null, smsBody: null, emailSubject: "", emailBody: "" };
}

// ─── SMS step sub-editor (needs ref for PlaceholderPicker) ──────────────────
function SmsStepEditor({ step, onChange, showAppointment }: { step: AutomationStep; onChange: (s: AutomationStep) => void; showAppointment?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Message body</Label>
      <Textarea
        ref={ref}
        rows={3}
        placeholder="Type your SMS message…"
        value={step.smsBody ?? ""}
        onChange={(e) => onChange({ ...step, smsBody: e.target.value })}
        className="text-xs resize-none"
      />
      <PlaceholderPicker
        targetRef={ref}
        onInsert={(token) => onChange({ ...step, smsBody: (step.smsBody ?? "") + token })}
        showAppointment={showAppointment}
      />
    </div>
  );
}

// ─── Email step sub-editor (needs ref for PlaceholderPicker) ─────────────────
function EmailStepEditor({ step, onChange, showAppointment }: { step: AutomationStep; onChange: (s: AutomationStep) => void; showAppointment?: boolean }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs text-muted-foreground">Subject</Label>
        <Input
          placeholder="Email subject…"
          value={step.emailSubject ?? ""}
          onChange={(e) => onChange({ ...step, emailSubject: e.target.value })}
          className="h-8 text-xs mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Body</Label>
        <Textarea
          ref={bodyRef}
          rows={4}
          placeholder="Email body…"
          value={step.emailBody ?? ""}
          onChange={(e) => onChange({ ...step, emailBody: e.target.value })}
          className="text-xs resize-none mt-1"
        />
        <PlaceholderPicker
          targetRef={bodyRef}
          onInsert={(token) => onChange({ ...step, emailBody: (step.emailBody ?? "") + token })}
          showAppointment={showAppointment}
          className="mt-2"
        />
      </div>
    </div>
  );
}

// ─── Individual step editor ───────────────────────────────────────────────────
function StepEditor({
  step, index, total,
  onChange, onDelete, onMoveUp, onMoveDown, showAppointment,
}: {
  step: AutomationStep; index: number; total: number;
  onChange: (s: AutomationStep) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  showAppointment?: boolean;
}) {
  const meta = STEP_META[step.stepType];

  return (
    <div className={`rounded-xl border p-4 ${meta.bg} transition-all`}>
      {/* Step header */}
      <div className="flex items-center gap-2 mb-3">
        <div className={`flex items-center gap-1.5 text-xs font-semibold ${meta.color}`}>
          {meta.icon}
          <span>Step {index + 1} — {meta.label}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Move up"
          >
            ▲
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Move down"
          >
            ▼
          </button>
          <button
            onClick={onDelete}
            className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-300"
            title="Delete step"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Wait step */}
      {step.stepType === "wait" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-14 shrink-0">Mode</Label>
            <Select
              value={step.waitMode ?? "delay"}
              onValueChange={(v) => onChange({ ...step, waitMode: v as WaitMode })}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delay">Wait for a duration</SelectItem>
                <SelectItem value="before_event">Wait until X time before an event</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-14 shrink-0">
              {step.waitMode === "before_event" ? "Before" : "Wait"}
            </Label>
            <Input
              type="number"
              min={1}
              value={step.waitValue ?? 1}
              onChange={(e) => onChange({ ...step, waitValue: parseInt(e.target.value) || 1 })}
              className="h-8 text-xs w-20"
            />
            <Select
              value={step.waitUnit ?? "hours"}
              onValueChange={(v) => onChange({ ...step, waitUnit: v as WaitUnit })}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">minutes</SelectItem>
                <SelectItem value="hours">hours</SelectItem>
                <SelectItem value="days">days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {step.waitMode === "before_event" && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground w-14 shrink-0">Event</Label>
              <Select
                value={step.eventType ?? "appointment"}
                onValueChange={(v) => onChange({ ...step, eventType: v })}
              >
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="appointment">Appointment</SelectItem>
                  <SelectItem value="custom">Custom event (define later)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground italic">
            {step.waitMode === "before_event"
              ? `Send the next action ${step.waitValue ?? 1} ${step.waitUnit ?? "hours"} before the ${step.eventType ?? "event"}.`
              : `Pause the sequence for ${step.waitValue ?? 1} ${step.waitUnit ?? "hours"} before the next action.`}
          </p>
        </div>
      )}

      {/* SMS step */}
      {step.stepType === "sms" && (
        <SmsStepEditor step={step} onChange={onChange} showAppointment={showAppointment} />
      )}

      {/* iMessage step — same editor as SMS, reuses smsBody field */}
      {step.stepType === "imessage" && (
        <SmsStepEditor step={step} onChange={onChange} showAppointment={showAppointment} />
      )}

      {/* Email step */}
      {step.stepType === "email" && (
        <EmailStepEditor step={step} onChange={onChange} showAppointment={showAppointment} />
      )}
    </div>
  );
}

// ─── Insert-between connector ───────────────────────────────────────────────
function InsertBetween({ onInsert }: { onInsert: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-center my-1 group">
      <div className="w-0.5 h-3 bg-border" />
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-5 h-5 rounded-full border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-all"
          title="Insert step here"
        >
          <Plus size={10} />
        </button>
        {open && (
          <div className="absolute left-1/2 -translate-x-1/2 mt-1 z-10 flex gap-1 bg-popover border border-border rounded-lg shadow-lg p-1.5">
            {(["wait", "sms", "imessage", "email"] as StepType[]).map(type => {
              const m = STEP_META[type];
              return (
                <button
                  key={type}
                  onClick={() => { onInsert(type); setOpen(false); }}
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-all hover:opacity-90 ${m.bg} ${m.color}`}
                  title={`Insert ${m.label}`}
                >
                  {m.icon}
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="w-0.5 h-3 bg-border" />
    </div>
  );
}

// ─── Automation builder (edit view) ──────────────────────────────────────────
function AutomationBuilder({
  automation,
  allTags,
  onBack,
}: {
  automation: Automation | null; // null = new
  allTags: TagType[];
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const isNew = automation === null;

  const [name,               setName]               = useState(automation?.name ?? "New Automation");
  const [triggerType,        setTriggerType]        = useState<string>(automation?.triggerType ?? "tag_added");
  const [triggerTagId,       setTriggerTagId]       = useState<number | null>(automation?.triggerTagId ?? null);
  const [triggerCalendarId,  setTriggerCalendarId]  = useState<number | null>(automation?.triggerCalendarId ?? null);
  const [isActive,           setIsActive]           = useState(automation?.isActive ?? true);
  const [steps,              setSteps]              = useState<AutomationStep[]>(automation?.steps ?? []);

  // Fetch calendars for the appointment_booked calendar filter
  const calendarsQuery = trpc.calendars.list.useQuery(undefined, { staleTime: 60_000 });  
  const allCalendars = calendarsQuery.data ?? [];

  // Fetch existing steps if editing — only once on mount, never on window focus
  const stepsQuery = trpc.automations.get.useQuery(
    { id: automation?.id ?? 0 },
    {
      enabled: !isNew,
      staleTime: 0,                 // always re-fetch fresh steps when opening builder
      refetchOnWindowFocus: false,  // prevent focus events from overwriting edits
      refetchOnReconnect: false,
    }
  );
  // Sync steps from server only on initial load
  const stepsData = stepsQuery.data?.steps;
  const [stepsLoaded, setStepsLoaded] = useState(false);
  useEffect(() => {
    if (stepsData && !isNew && !stepsLoaded) {
      setSteps(stepsData as AutomationStep[]);
      setStepsLoaded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsData]);

  const createMutation = trpc.automations.create.useMutation({
    onSuccess: async (created) => {
      await saveStepsMutation.mutateAsync({ automationId: created.id, steps });
      await utils.automations.list.invalidate();
      toast.success("Automation created!");
      onBack();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.automations.update.useMutation({
    onSuccess: async () => {
      await saveStepsMutation.mutateAsync({ automationId: automation!.id, steps });
      await utils.automations.list.invalidate();
      toast.success("Automation saved!");
      onBack();
    },
    onError: (e) => toast.error(e.message),
  });

  const saveStepsMutation = trpc.automations.saveSteps.useMutation({
    onSuccess: () => {
      // Invalidate the get cache so next open always loads fresh steps
      if (automation?.id) utils.automations.get.invalidate({ id: automation.id });
    },
    onError: (e) => toast.error("Steps save failed: " + e.message),
  });

  function addStep(type: StepType, atIndex?: number) {
    if (atIndex !== undefined) {
      setSteps(prev => [
        ...prev.slice(0, atIndex + 1),
        blankStep(type),
        ...prev.slice(atIndex + 1),
      ]);
    } else {
      setSteps(prev => [...prev, blankStep(type)]);
    }
  }

  function updateStep(index: number, updated: AutomationStep) {
    setSteps(prev => prev.map((s, i) => i === index ? updated : s));
  }

  function deleteStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: "up" | "down") {
    setSteps(prev => {
      const arr = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  }

  function handleSave() {
    if (!name.trim()) { toast.error("Automation name is required"); return; }
    const calId = triggerType === "appointment_booked" ? triggerCalendarId : null;
    if (isNew) {
      createMutation.mutate({ name, triggerType, triggerTagId: triggerType === "tag_added" ? triggerTagId : null, triggerCalendarId: calId, isActive });
    } else {
      updateMutation.mutate({ id: automation!.id, name, triggerType, triggerTagId: triggerType === "tag_added" ? triggerTagId : null, triggerCalendarId: calId, isActive });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending || saveStepsMutation.isPending;

  // ── AI builder state ────────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const aiEndRef = useRef<HTMLDivElement>(null);

  const buildMutation = trpc.automations.buildFromPrompt.useMutation({
    onSuccess: (blueprint) => {
      // Populate the visual builder with the AI-generated automation
      setName(blueprint.name);
      setTriggerType(blueprint.triggerType);
      const aiSteps = (blueprint.steps as unknown as AutomationStep[]).map((s) => ({
        stepType:     s.stepType,
        waitValue:    s.waitValue ?? null,
        waitUnit:     s.waitUnit ?? null,
        waitMode:     s.waitMode ?? null,
        eventType:    s.eventType ?? null,
        smsBody:      s.smsBody ?? null,
        emailSubject: s.emailSubject ?? null,
        emailBody:    s.emailBody ?? null,
      }));
      setSteps(aiSteps);
      setAiMessages(prev => [
        ...prev,
        { role: "assistant", text: `Done! I've built "${blueprint.name}" with ${aiSteps.length} step${aiSteps.length !== 1 ? "s" : ""}. Review it in the builder on the left, then click Save when ready.` },
      ]);
      setAiPrompt("");
    },
    onError: (e) => {
      setAiMessages(prev => [...prev, { role: "assistant", text: `Sorry, something went wrong: ${e.message}` }]);
    },
  });

  function sendAiPrompt() {
    const text = aiPrompt.trim();
    if (!text || buildMutation.isPending) return;
    setAiMessages(prev => [...prev, { role: "user", text }]);
    buildMutation.mutate({ prompt: text });
    setTimeout(() => aiEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0 flex items-center gap-3 bg-background/70 backdrop-blur-sm">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/6 transition-all"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm font-semibold bg-transparent border-transparent hover:border-border focus:border-primary px-2"
            placeholder="Automation name…"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">Active</span>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAiOpen(o => !o)}
          className="shrink-0 gap-1.5 border-violet-500/40 text-violet-400 hover:bg-violet-500/10"
        >
          <Sparkles size={14} />
          Ask AI
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving}
          className="shrink-0"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin mr-1" /> : <CheckCircle2 size={14} className="mr-1" />}
          Save
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: trigger + steps canvas */}
        <ScrollArea className="flex-1 p-6">
          <div className="max-w-xl mx-auto space-y-3">

            {/* Trigger block */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 mb-3">
                <Zap size={14} />
                <span>Trigger</span>
              </div>
              {/* Trigger type */}
              <div className="flex items-center gap-2 mb-3">
                <Label className="text-xs text-muted-foreground w-20 shrink-0">Event</Label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tag_added">Tag added to contact</SelectItem>
                    <SelectItem value="appointment_booked">Appointment booked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Tag selector — only for tag_added */}
              {triggerType === "tag_added" && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground w-20 shrink-0">When tag</Label>
                  <Select
                    value={triggerTagId ? String(triggerTagId) : "__any__"}
                    onValueChange={(v) => setTriggerTagId(v === "__any__" ? null : parseInt(v))}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Any tag" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Any tag</SelectItem>
                      {allTags.map(t => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label className="text-xs text-muted-foreground shrink-0">is added</Label>
                </div>
              )}
              {/* Appointment booked calendar filter */}
              {triggerType === "appointment_booked" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground w-20 shrink-0">In calendar</Label>
                    <Select
                      value={triggerCalendarId ? String(triggerCalendarId) : "__any__"}
                      onValueChange={(v) => setTriggerCalendarId(v === "__any__" ? null : parseInt(v))}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Any calendar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">Any calendar</SelectItem>
                        {allCalendars.map((c: { id: number; name: string }) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Fires when an appointment is created with a linked contact.
                    Use <span className="font-mono text-emerald-400 text-[11px]">Wait — Before Event</span> steps to send messages X time before the appointment starts.
                  </p>
                </div>
              )}
            </div>

            {/* Connector line */}
            {steps.length > 0 && (
              <div className="flex justify-center">
                <div className="w-0.5 h-4 bg-border" />
              </div>
            )}

            {/* Steps */}
            {steps.map((step, i) => (
              <div key={i}>
                <StepEditor
                  step={step}
                  index={i}
                  total={steps.length}
                  onChange={(s) => updateStep(i, s)}
                  onDelete={() => deleteStep(i)}
                  onMoveUp={() => moveStep(i, "up")}
                  onMoveDown={() => moveStep(i, "down")}
                  showAppointment={triggerType === "appointment_booked"}
                />
                {/* Insert-between connector */}
                <InsertBetween onInsert={(type) => addStep(type, i)} />
              </div>
            ))}

            {/* Add step buttons */}
            <div className="flex justify-center pt-2">
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {(["wait", "sms", "imessage", "email"] as StepType[]).map(type => {
                  const m = STEP_META[type];
                  return (
                    <button
                      key={type}
                      onClick={() => addStep(type)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all hover:opacity-90 ${m.bg} ${m.color}`}
                    >
                      <Plus size={11} />
                      Add {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {steps.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p>No steps yet. Add a Wait, SMS, iMessage, or Email step above.</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* AI chat panel — slides in when aiOpen */}
        {aiOpen && (
          <div className="w-80 shrink-0 border-l border-violet-500/30 bg-violet-500/5 flex flex-col overflow-hidden">
            {/* AI panel header */}
            <div className="px-4 py-3 border-b border-violet-500/20 flex items-center gap-2">
              <Sparkles size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-violet-300">AI Automation Builder</span>
              <button
                onClick={() => setAiOpen(false)}
                className="ml-auto text-muted-foreground hover:text-foreground text-xs"
              >✕</button>
            </div>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {aiMessages.length === 0 && (
                <div className="text-[11px] text-muted-foreground space-y-2 pt-2">
                  <p className="font-medium text-violet-300">Describe the automation you want.</p>
                  <p>Examples:</p>
                  <button
                    onClick={() => setAiPrompt("When a tag is added, wait 5 minutes then send an SMS saying Hi {{first_name}}, thanks for your interest! We'll be in touch shortly.")}
                    className="block text-left w-full rounded-lg border border-violet-500/20 bg-violet-500/10 px-2 py-1.5 hover:bg-violet-500/20 transition-colors"
                  >
                    "When a tag is added, wait 5 mins then send a welcome SMS"
                  </button>
                  <button
                    onClick={() => setAiPrompt("When an appointment is booked, send an SMS confirmation immediately, then send a reminder SMS 30 minutes before the appointment.")}
                    className="block text-left w-full rounded-lg border border-violet-500/20 bg-violet-500/10 px-2 py-1.5 hover:bg-violet-500/20 transition-colors"
                  >
                    "Appointment booked: confirm now + reminder 30 min before"
                  </button>
                  <button
                    onClick={() => setAiPrompt("Send a follow-up SMS 1 hour after tag added, then an email 24 hours later with subject 'Following up' and a short body.")}
                    className="block text-left w-full rounded-lg border border-violet-500/20 bg-violet-500/10 px-2 py-1.5 hover:bg-violet-500/20 transition-colors"
                  >
                    "SMS after 1 hour, then email after 24 hours"
                  </button>
                </div>
              )}
              {aiMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-violet-500/15 text-violet-100 border border-violet-500/20"
                  }`}>
                    {m.role === "assistant" && <Sparkles size={10} className="inline mr-1 text-violet-400" />}
                    {m.text}
                  </div>
                </div>
              ))}
              {buildMutation.isPending && (
                <div className="flex justify-start">
                  <div className="rounded-xl px-3 py-2 bg-violet-500/15 border border-violet-500/20 flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-violet-400" />
                    <span className="text-[11px] text-violet-300">Building automation…</span>
                  </div>
                </div>
              )}
              <div ref={aiEndRef} />
            </div>
            {/* Input */}
            <div className="p-3 border-t border-violet-500/20">
              <div className="flex gap-2">
                <Textarea
                  rows={3}
                  placeholder="Describe the automation you want…"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiPrompt(); } }}
                  className="text-[11px] resize-none flex-1 bg-background/50 border-violet-500/30 focus:border-violet-400"
                  disabled={buildMutation.isPending}
                />
                <button
                  onClick={sendAiPrompt}
                  disabled={!aiPrompt.trim() || buildMutation.isPending}
                  className="self-end w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center transition-colors"
                >
                  <Send size={13} className="text-white" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">Press Enter to send · Shift+Enter for new line</p>
            </div>
          </div>
        )}

        {/* Right: help panel */}
        <div className="w-64 shrink-0 border-l border-border p-4 hidden lg:flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">How it works</p>
            <div className="space-y-2 text-[11px] text-muted-foreground">
              <p>1. When the trigger tag is added to a contact, they are enrolled in this automation.</p>
              <p>2. Steps run in order from top to bottom.</p>
              <p>3. <span className="text-amber-400">Wait</span> steps pause the sequence.</p>
              <p>4. <span className="text-sky-400">SMS</span> steps send a text via Telnyx.</p>
              <p>5. <span className="text-green-400">iMessage</span> steps send an iMessage via Blooio.</p>
              <p>6. <span className="text-violet-400">Email</span> steps send an email via Mailgun.</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Wait modes</p>
            <div className="space-y-2 text-[11px] text-muted-foreground">
              <p><span className="text-amber-400">Wait for a duration</span> — pause X minutes/hours/days before the next step.</p>
              <p><span className="text-amber-400">Before an event</span> — send the next action X time before a scheduled event (e.g. appointment).</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Variables</p>
            <div className="space-y-1 text-[11px] text-muted-foreground font-mono">
              <p>{"{{first_name}}"}</p>
              <p>{"{{last_name}}"}</p>
              <p>{"{{phone}}"}</p>
              <p>{"{{email}}"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status badge helper ─────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    executed:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    waiting:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
    skipped:   "bg-muted/50 text-muted-foreground border-border",
    failed:    "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const cls = map[status] ?? "bg-muted/50 text-muted-foreground border-border";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{label}</span>;
}

// ─── Step type icon helper ────────────────────────────────────────────────────
function StepTypeIcon({ type }: { type: string }) {
  if (type === "sms")      return <MessageSquare size={12} className="text-sky-400" />;
  if (type === "email")    return <Mail size={12} className="text-violet-400" />;
  if (type === "imessage") return <MessageSquare size={12} className="text-green-400" />;
  return <Clock size={12} className="text-amber-400" />;
}

// ─── Execution Logs panel ─────────────────────────────────────────────────────
function ExecutionLogsPanel({ automations }: { automations: Automation[] }) {
  const [automationId, setAutomationId] = useState<number | undefined>(undefined);
  const [stepType, setStepType]         = useState<string | undefined>(undefined);
  const [status, setStatus]             = useState<string | undefined>(undefined);
  const [fromDate, setFromDate]         = useState<string>("");
  const [toDate, setToDate]             = useState<string>("");
  const [page, setPage]                 = useState(0);
  const PAGE_SIZE = 50;

  const fromTs = useMemo(() => fromDate ? new Date(fromDate).getTime() : undefined, [fromDate]);
  const toTs   = useMemo(() => toDate   ? new Date(toDate + "T23:59:59").getTime() : undefined, [toDate]);

  const { data, isLoading, refetch, isFetching } = trpc.automations.executionLogs.useQuery(
    { automationId, stepType, status, fromTs, toTs, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { staleTime: 10_000 },
  );

  const logs  = data?.logs  ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [automationId, stepType, status, fromTs, toTs]);

  function fmtTs(ts: number) {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function getAutoName(id: number) {
    return automations.find(a => a.id === id)?.name ?? `#${id}`;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-border bg-background/70 shrink-0 flex flex-wrap items-center gap-2">
        {/* Automation filter */}
        <Select
          value={automationId !== undefined ? String(automationId) : "all"}
          onValueChange={v => setAutomationId(v === "all" ? undefined : Number(v))}
        >
          <SelectTrigger className="h-8 text-xs w-44">
            <SelectValue placeholder="All automations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All automations</SelectItem>
            {automations.map(a => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Step type filter */}
        <Select
          value={stepType ?? "all"}
          onValueChange={v => setStepType(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="imessage">iMessage</SelectItem>
            <SelectItem value="wait">Wait</SelectItem>
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select
          value={status ?? "all"}
          onValueChange={v => setStatus(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="executed">Executed</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range */}
        <Input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="h-8 text-xs w-36"
          placeholder="From date"
        />
        <span className="text-muted-foreground text-xs">→</span>
        <Input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="h-8 text-xs w-36"
          placeholder="To date"
        />

        <button
          onClick={() => refetch()}
          className="ml-auto w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-44">Contact</TableHead>
              <TableHead className="w-48">Automation</TableHead>
              <TableHead className="w-28">Action</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead className="w-40 text-right">Executed On</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                  No execution logs yet. Logs will appear here as automations run.
                </TableCell>
              </TableRow>
            )}
            {logs.map(log => (
              <TableRow key={log.id} className="text-xs">
                <TableCell className="font-medium">
                  <span className="text-foreground">Contact #{log.contactId}</span>
                </TableCell>
                <TableCell className="text-muted-foreground truncate max-w-[180px]">
                  {getAutoName(log.automationId)}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <StepTypeIcon type={log.stepType} />
                    <span className="capitalize">{log.stepType}</span>
                  </span>
                </TableCell>
                <TableCell><StatusBadge status={log.status} /></TableCell>
                <TableCell className="text-muted-foreground truncate max-w-[220px]">{log.detail ?? "—"}</TableCell>
                <TableCell className="text-right text-muted-foreground">{fmtTs(log.executedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="px-4 py-2 border-t border-border shrink-0 flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span>{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Automation list view ─────────────────────────────────────────────────────
function AutomationList({
  allTags,
  onEdit,
  onNew,
}: {
  allTags: TagType[];
  onEdit: (a: Automation) => void;
  onNew: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: automations = [], isLoading } = trpc.automations.list.useQuery(undefined, { staleTime: 30_000 });

  const toggleMutation = trpc.automations.update.useMutation({
    onSuccess: () => utils.automations.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.automations.delete.useMutation({
    onSuccess: () => { utils.automations.list.invalidate(); toast.success("Automation deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const setupHeartbeatMutation = trpc.automations.setupHeartbeat.useMutation({
    onSuccess: (data) => {
      toast.success(data.created ? "Automation scheduler registered — runs every minute" : "Automation scheduler already active");
    },
    onError: (e) => toast.error(`Scheduler setup failed: ${e.message}`),
  });

  const runNowMutation = trpc.automations.runNow.useMutation({
    onSuccess: (data) => {
      if (data.ok) toast.success("Automation processor triggered — pending steps will send now");
      else toast.error(`Processor returned ${data.status}`);
    },
    onError: (e) => toast.error(`Run failed: ${e.message}`),
  });

  const [activeTab, setActiveTab] = useState<"list" | "logs">("list");

  function getTagName(id: number | null) {
    if (!id) return "Any tag";
    return allTags.find(t => t.id === id)?.name ?? `Tag #${id}`;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between bg-background/70 backdrop-blur-sm">
        <div>
          <p className="text-base font-semibold gradient-text">Automations</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {automations.length} automation{automations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "list" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowMutation.isPending}
                title="Manually trigger the automation processor to send any pending steps right now"
              >
                {runNowMutation.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Zap size={13} className="mr-1" />}
                Run Now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setupHeartbeatMutation.mutate()}
                disabled={setupHeartbeatMutation.isPending}
                title="Register the automation scheduler to run every minute (required once after deployment)"
              >
                {setupHeartbeatMutation.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : <CheckCircle2 size={13} className="mr-1" />}
                Setup Scheduler
              </Button>
              <Button size="sm" onClick={onNew}>
                <Plus size={14} className="mr-1" />
                New Automation
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab strip */}
      <div className="px-6 pt-3 pb-0 border-b border-border shrink-0">
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "list" | "logs")}>
          <TabsList className="h-8">
            <TabsTrigger value="list" className="text-xs px-4">Automations</TabsTrigger>
            <TabsTrigger value="logs" className="text-xs px-4">Execution Logs</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Execution Logs tab */}
      {activeTab === "logs" && (
        <ExecutionLogsPanel automations={automations as Automation[]} />
      )}

      {/* List tab */}
      {activeTab === "list" && (<ScrollArea className="flex-1 p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {!isLoading && automations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Zap size={40} className="text-muted-foreground opacity-30" />
            <p className="text-sm font-medium text-foreground">No automations yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Create your first automation to automatically send SMS and email sequences when a tag is added to a contact.
            </p>
            <Button size="sm" onClick={onNew} className="mt-2">
              <Plus size={14} className="mr-1" />
              Create Automation
            </Button>
          </div>
        )}

        {!isLoading && automations.length > 0 && (
          <div className="space-y-2 max-w-2xl mx-auto">
            {(automations as Automation[]).map(a => (
              <div
                key={a.id}
                className="rounded-xl border border-border bg-card hover:border-primary/30 transition-all group"
              >
                <div className="flex items-center gap-3 p-4">
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${a.isActive ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        Trigger: tag added →{" "}
                        <span className="text-primary">{getTagName(a.triggerTagId)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Active toggle */}
                  <Switch
                    checked={a.isActive}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: a.id, isActive: v })}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* Edit button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(a)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Edit
                    <ChevronRight size={14} className="ml-1" />
                  </Button>

                  {/* Delete */}
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${a.name}"?`)) deleteMutation.mutate({ id: a.id });
                    }}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>)}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function AutomationsPanel({ allTags }: { allTags: TagType[] }) {
  const [editing, setEditing] = useState<Automation | null | "new">(null);

  if (editing === "new") {
    return (
      <AutomationBuilder
        automation={null}
        allTags={allTags}
        onBack={() => setEditing(null)}
      />
    );
  }

  if (editing !== null) {
    return (
      <AutomationBuilder
        automation={editing}
        allTags={allTags}
        onBack={() => setEditing(null)}
      />
    );
  }

  return (
    <AutomationList
      allTags={allTags}
      onEdit={(a) => setEditing(a)}
      onNew={() => setEditing("new")}
    />
  );
}
