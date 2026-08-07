"use client";

import { AuthCardHeader, AuthShell } from "@/features/auth/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/auth/api";
import Link from "next/link";
import * as React from "react";

/**
 * Request a password-reset link. The API never reveals whether an email is
 * registered, so on a completed request we always show the same neutral
 * confirmation - never "no such account".
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch {
      // Only a genuine network/5xx failure reaches here - the API returns ok
      // whether or not the email exists, so this is not "no such account".
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthCardHeader
        icon={<Icon name={sent ? "mark_email_read" : "lock_reset"} size={20} />}
        title="Reset your password"
        description={
          sent
            ? "Check your inbox for the next step."
            : "Enter your email and we'll send you a reset link."
        }
      />

      {sent ? (
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-2 rounded-md border border-success-border bg-success-muted px-3 py-2.5 text-sm text-success-muted-foreground">
            <Icon name="check_circle" size={16} className="mt-0.5 shrink-0" />
            <span>
              If that email is registered, we&rsquo;ve sent a reset link. It expires in 1 hour.
            </span>
          </div>
          <Link
            href="/login"
            className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 p-6">
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

          {error ? (
            <div className="flex items-center gap-1.5 rounded-md border border-danger-border bg-danger-muted px-3 py-2 text-sm text-danger-muted-foreground">
              <Icon name="error" size={15} /> {error}
            </div>
          ) : null}

          <Button type="submit" disabled={submitting} className="mt-1 gap-1.5">
            {submitting ? (
              <>
                <Icon name="progress_activity" size={16} className="animate-spin" /> Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
          <Link
            href="/login"
            className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
