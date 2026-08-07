"use client";

import { AuthCardHeader, AuthShell } from "@/features/auth/components/auth-shell";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { resetPassword } from "@/features/auth/api";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

const MIN_LENGTH = 12;

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // A link with no token can never succeed - say so up front rather than after a
  // failed submit.
  if (!token) {
    return (
      <AuthShell>
        <AuthCardHeader
          icon={<Icon name="link_off" size={20} />}
          title="This reset link is incomplete"
          description="The link may have been cut off in your email. Request a fresh one."
        />
        <div className="flex flex-col gap-4 p-6">
          <Link
            href="/forgot"
            className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      router.push("/login?reset=1");
    } catch (err) {
      // Invalid/expired token, or a network error - show the API's message.
      setError(err instanceof Error ? err.message : "Couldn't reset your password.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthCardHeader
        icon={<Icon name="lock_reset" size={20} />}
        title="Choose a new password"
        description={`Use at least ${MIN_LENGTH} characters.`}
      />
      <form onSubmit={submit} className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            New password
          </label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 12 characters"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-sm font-medium">
            Confirm password
          </label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter it"
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
              <Icon name="progress_activity" size={16} className="animate-spin" /> Updating…
            </>
          ) : (
            "Update password"
          )}
        </Button>
        <Link
          href="/forgot"
          className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Request a new link
        </Link>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <React.Suspense>
      <ResetForm />
    </React.Suspense>
  );
}
