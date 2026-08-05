"use client";

import { AuthCardHeader, AuthShell } from "@/features/auth/components/auth-shell";
import { BuildMarker } from "@/components/layout/build-marker";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { login } from "@/features/auth/api";
import { safeNext } from "@/features/auth/safe-next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * Only the part that needs the URL. Reading useSearchParams opts this subtree
 * out of prerendering, so it is kept as small as possible - see LoginPage.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const justReset = searchParams.get("reset") === "1";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-6">
      {justReset ? (
        <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          <Icon name="check_circle" size={15} /> Password updated - sign in with your new password.
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Link href="/forgot" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <Icon name="error" size={15} /> {error}
        </div>
      ) : null}

      <Button type="submit" disabled={submitting} className="mt-1 gap-1.5">
        {submitting ? (
          <>
            <Icon name="progress_activity" size={16} className="animate-spin" /> Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell footer={<BuildMarker />}>
      <AuthCardHeader
        icon={<Icon name="lock" size={20} />}
        title="Sign in"
        description="Finlot’s AI workforce for document-led origination."
      />

      {/* The Suspense boundary wraps ONLY the form, because only the form reads
          useSearchParams. Wrapping the whole card (as this once did) opted the
          build marker out of prerendering too. */}
      <React.Suspense fallback={<div className="p-6" />}>
        <LoginForm />
      </React.Suspense>
    </AuthShell>
  );
}
