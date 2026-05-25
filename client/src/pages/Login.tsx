import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Lock, AlertCircle } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // If already authenticated, redirect to app
  const { data: user, isLoading: authLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!authLoading && user) {
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("returnTo") ?? "/";
    }
  }, [authLoading, user]);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      // Redirect to app after successful login
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo") ?? "/";
      window.location.href = returnTo;
    },
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email: email.trim(), password });
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
          <h1
            className="text-4xl font-bold tracking-tight"
            style={{
              background: "linear-gradient(135deg, #ffffff 0%, #a78bfa 50%, #c4b5fd 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              textShadow: "none",
              filter: "drop-shadow(0 0 30px rgba(139,92,246,0.5))",
            }}
          >
            OliviaAI
          </h1>
          <p className="text-sm text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 border"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(20px)",
            borderColor: "rgba(255,255,255,0.1)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                <Mail size={11} /> Email
              </Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="h-10 text-sm"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                <Lock size={11} /> Password
              </Label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your password"
                required
                className="h-10 text-sm"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2.5">
                <AlertCircle size={12} className="shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 text-sm font-medium mt-1"
              disabled={loginMutation.isPending}
              style={{
                background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                boxShadow: loginMutation.isPending ? "none" : "0 0 20px rgba(124,58,237,0.4)",
              }}
            >
              {loginMutation.isPending ? (
                <><Loader2 size={14} className="animate-spin mr-1.5" /> Signing in…</>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Don't have an account? Contact your administrator.
        </p>
      </div>
    </div>
  );
}
