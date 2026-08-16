"use client";

import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { AuthCardHeader, AuthShell } from "@/features/auth/components/auth-shell";
import { safeAdminNext } from "@/features/auth/safe-next";
import {
  platformAuthStatus,
  platformBootstrap,
  platformLogin,
} from "@/features/platform/api";
import { sanitizeEmail } from "@/lib/validators";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeAdminNext(searchParams.get("next"));

  const [mode, setMode] = React.useState<"loading" | "login" | "setup">("loading");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void platformAuthStatus()
      .then((s) => {
        if (!cancelled) setMode(s.needsSetup ? "setup" : "login");
      })
      .catch(() => {
        if (!cancelled) setMode("login");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "setup") {
        await platformBootstrap({ email: email.trim(), password });
      } else {
        await platformLogin(email.trim(), password);
      }
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
      setSubmitting(false);
    }
  }

  if (mode === "loading") {
    return <div className="h-48 p-6" />;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="admin-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(sanitizeEmail(e.target.value))}
          placeholder="you@finlot.ai"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin-password" className="text-sm font-medium">
          Password
        </label>
        <PasswordInput
          id="admin-password"
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          required
          minLength={mode === "setup" ? 12 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "setup" ? "At least 12 characters" : "••••••••"}
        />
      </div>

      {error ? (
        <div className="flex items-center gap-1.5 rounded-md border border-danger-border bg-danger-muted px-3 py-2 text-sm text-danger-muted-foreground">
          <Icon name="error" size={15} /> {error}
        </div>
      ) : null}

      <Button type="submit" disabled={submitting} className="mt-1 gap-1.5">
        {submitting ? (
          <>
            <Icon name="progress_activity" size={16} className="animate-spin" />{" "}
            {mode === "setup" ? "Creating..." : "Signing in..."}
          </>
        ) : mode === "setup" ? (
          "Create platform admin"
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <AuthShell
      resolveTenant={false}
      brandHref="/admin/login"
      kicker="Platform console"
      headline={
        <>
          Workspaces.
          <br />
          Not cases.
          <br />
          One console.
        </>
      }
      pitch="Create tenants, set their owner credentials, and keep Finlot operators out of workspace membership."
      chips={[
        { tone: "mint", title: "Create", body: "A workspace and its owner" },
        { tone: "peach", title: "Credentials", body: "Reset without joining" },
        { tone: "lilac", title: "Isolate", body: "Never a tenant login" },
      ]}
      asideFooter="This is not a workspace sign-in. Tenant staff use /login."
    >
      <AuthCardHeader
        icon={<Icon name="admin_panel_settings" size={20} />}
        title="Platform admin"
        description="Super-admin only. Tenant owners sign in on their own workspace."
      />
      <React.Suspense fallback={<div className="p-6" />}>
        <AdminLoginForm />
      </React.Suspense>
    </AuthShell>
  );
}
