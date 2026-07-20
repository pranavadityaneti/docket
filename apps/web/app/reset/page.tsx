"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { resetPassword } from "@/lib/api";

const MIN_LENGTH = 12;

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // A link with no token can never succeed — say so up front rather than after a
  // failed submit.
  if (!token) {
    return (
      <Shell icon="link_off" title="This reset link is incomplete">
        <p className="text-sm text-muted-foreground">
          The link may have been cut off in your email. Request a fresh one.
        </p>
        <Link
          href="/forgot"
          className="text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Request a new link
        </Link>
      </Shell>
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
      // Invalid/expired token, or a network error — show the API's message.
      setError(err instanceof Error ? err.message : "Couldn't reset your password.");
      setSubmitting(false);
    }
  }

  return (
    <Shell icon="lock_reset" title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            New password
          </label>
          <Input
            id="password"
            type="password"
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
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter it"
          />
        </div>

        {error ? (
          <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
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
          className="text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Request a new link
        </Link>
      </form>
    </Shell>
  );
}

/** Shared card frame so the token-missing and form states match the login page. */
function Shell({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm gap-0 p-0">
        <div className="flex flex-col items-center gap-2 border-b p-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name={icon} size={20} />
          </div>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="flex flex-col gap-4 p-6">{children}</div>
      </Card>
    </div>
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
