import { useEffect, useMemo, useState } from "react";
import { Sparkles, Pencil, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function fmtDate(ts: string | Date) {
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Header button + popup modal ──────────────────────────────────────────────
// Auto-opens once per session when the user has undismissed updates, and can be
// reopened manually to browse all past updates (including dismissed ones).
export function WhatsNewMenu() {
  const { data: currentUser } = trpc.auth.me.useQuery(undefined, { staleTime: 120_000 });
  const { data: updates = [] } = trpc.whatsNew.list.useQuery(undefined, {
    enabled: !!currentUser,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();
  const dismissMutation = trpc.whatsNew.dismiss.useMutation({
    onSuccess: () => void utils.whatsNew.list.invalidate(),
  });

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"unseen" | "all">("all");
  const [autoShown, setAutoShown] = useState(false);

  const unseen = useMemo(() => updates.filter(u => !u.dismissed), [updates]);

  // Auto-popup once per session when there are unseen updates.
  useEffect(() => {
    if (autoShown || unseen.length === 0) return;
    setMode("unseen");
    setOpen(true);
    setAutoShown(true);
  }, [unseen.length, autoShown]);

  const shown = mode === "unseen" ? unseen : updates;

  const handleDismiss = () => {
    const ids = unseen.map(u => u.id);
    if (ids.length > 0) {
      dismissMutation.mutate({ updateIds: ids });
    }
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => {
          setMode("all");
          setOpen(true);
        }}
        className="relative w-8 h-8 border-border text-muted-foreground hover:text-foreground"
        title="What's New"
      >
        <Sparkles size={14} />
        {unseen.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
            {unseen.length > 9 ? "9+" : unseen.length}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {mode === "unseen" ? "What's New" : "What's New — All Updates"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto flex flex-col gap-4 pr-1">
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No updates yet.
              </p>
            ) : (
              shown.map(u => (
                <div key={u.id} className="border-b border-border/60 pb-3 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">{u.title}</h3>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtDate(u.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                    {u.body}
                  </p>
                </div>
              ))
            )}
          </div>

          {mode === "unseen" && unseen.length > 0 && (
            <DialogFooter>
              <Button
                onClick={handleDismiss}
                className="w-full"
                disabled={dismissMutation.isPending}
              >
                Got it
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Admin management UI ──────────────────────────────────────────────────────
// Embedded in the (admin-only) Settings panel. Lets admins add/edit/delete the
// updates that everyone sees in the What's New modal.
export function WhatsNewAdmin() {
  const { data: updates = [] } = trpc.whatsNew.list.useQuery(undefined, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const invalidate = () => void utils.whatsNew.list.invalidate();

  const createMutation = trpc.whatsNew.create.useMutation({ onSuccess: invalidate });
  const updateMutation = trpc.whatsNew.update.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.whatsNew.delete.useMutation({ onSuccess: invalidate });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const reset = () => {
    setEditingId(null);
    setTitle("");
    setBody("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      toast.error("Title and body are required");
      return;
    }
    if (editingId) {
      updateMutation.mutate(
        { id: editingId, title: t, body: b },
        { onSuccess: () => { toast.success("Update saved"); reset(); } },
      );
    } else {
      createMutation.mutate(
        { title: t, body: b },
        { onSuccess: () => { toast.success("Update published"); reset(); } },
      );
    }
  };

  const startEdit = (u: { id: number; title: string; body: string }) => {
    setEditingId(u.id);
    setTitle(u.title);
    setBody(u.body);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, { onSuccess: () => {
      toast.success("Update deleted");
      if (editingId === id) reset();
    } });
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="border-b border-border bg-card/40 px-6 py-4">
      <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
        <Sparkles size={14} className="text-primary" /> What's New — Manage Updates
      </p>

      <form onSubmit={submit} className="space-y-3 mb-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Title</Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. New: bulk SMS scheduling"
            maxLength={255}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Short description of what changed…"
            rows={3}
            className="text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" className="h-8 text-xs gap-1.5" disabled={saving}>
            {editingId ? <Pencil size={13} /> : <Plus size={13} />}
            {editingId ? "Save changes" : "Publish update"}
          </Button>
          {editingId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1.5"
              onClick={reset}
            >
              <X size={13} /> Cancel
            </Button>
          )}
        </div>
      </form>

      <div className="flex flex-col gap-2">
        {updates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No updates published yet.</p>
        ) : (
          updates.map(u => (
            <div
              key={u.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-medium text-foreground truncate">{u.title}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {fmtDate(u.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => startEdit(u)}
                  title="Edit"
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(u.id)}
                  disabled={deleteMutation.isPending}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
