import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, CheckCircle2, AlertCircle } from "lucide-react";

export default function AcceptInvite() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    setToken(t);
  }, []);

  const acceptMutation = trpc.auth.acceptInvite.useMutation({
    onSuccess: () => {
      setDone(true);
      // Redirect to app after a short delay
      setTimeout(() => { window.location.href = "/"; }, 1500);
    },
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!token) {
      setError("Invalid invite link — no token found");
      return;
    }
    acceptMutation.mutate({ token, password });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(to right, white 1px, transparent 1px),
            linear-gradient(to bottom, white 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />
      {/* Glow orb */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold gradient-text tracking-tight" style={{ textShadow: "0 0 40px rgba(139,92,246,0.4)" }}>
            OliviaAI
          </h1>
          <p className="text-sm text-muted-foreground mt-1">You've been invited — set your password to get started</p>
        </div>

        {/* Card */}
        <div className="glass-card rounded-2xl p-6 border border-white/10">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-foreground">Password set!</p>
              <p className="text-xs text-muted-foreground">Redirecting you to the app…</p>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
                <AlertCircle size={24} className="text-red-400" />
              </div>
              <p className="text-sm font-semibold text-foreground">Invalid invite link</p>
              <p className="text-xs text-muted-foreground">This link is missing a token. Please ask your admin to resend the invite.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock size={14} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">Set your password</span>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">New Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  className="h-9 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Confirm Password</Label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                  className="h-9 text-sm"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                  <AlertCircle size={12} />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full h-9 text-sm" disabled={acceptMutation.isPending}>
                {acceptMutation.isPending ? (
                  <><Loader2 size={13} className="animate-spin mr-1.5" /> Setting password…</>
                ) : (
                  "Set Password & Sign In"
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
