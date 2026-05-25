import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dialer from "./pages/Dialer";
import Login from "./pages/Login";
import AcceptInvite from "./pages/AcceptInvite";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

// ─── Auth Guard ───────────────────────────────────────────────────────────────
// Wraps protected routes: redirects to /login if not authenticated.
// Also strips stale OAuth ?code= / ?state= params from the URL.
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });

  // Strip stale OAuth params (?code=, ?state=) from the URL
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("code") || url.searchParams.has("state")) {
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      const returnTo = location !== "/" ? `?returnTo=${encodeURIComponent(location)}` : "";
      setLocation(`/login${returnTo}`);
    }
  }, [isLoading, user, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading OliviaAI…</p>
        </div>
      </div>
    );
  }

  if (!user) return null; // Will redirect via useEffect above

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={Login} />
      <Route path="/invite" component={AcceptInvite} />

      {/* Protected routes */}
      <Route path="/">
        <AuthGuard>
          <Dialer />
        </AuthGuard>
      </Route>

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
