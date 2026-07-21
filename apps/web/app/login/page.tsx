"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { login } from "@/lib/api";
import { BuildMarker } from "@/components/build-marker";

const DEFAULT_NEXT = "/cases";

/**
 * Where to send the user after sign-in, from ?next=.
 *
 * `next` is attacker-controllable — anyone can craft a link to our real login
 * page — so it must never be handed to the router unchecked. Without this,
 * /login?next=https://evil.example sends a user who just authenticated on the
 * genuine site straight to someone else's: a credible phishing hand-off, and a
 * nasty one for a lender, where the next screen plausibly asks for bank details.
 *
 * Only same-origin, absolute-path targets are allowed. Rejected:
 *   https://evil.example  — absolute URL, leaves the site
 *   //evil.example        — protocol-relative, also leaves the site
 *   javascript:alert(1)   — not a path at all
 * Anything suspicious falls back to the default rather than failing loudly;
 * there's no legitimate reason for a real link to carry one.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_NEXT;
  return raw;
}

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
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm gap-0 p-0">
        <div className="flex flex-col items-center gap-2 border-b p-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="lock" size={20} />
          </div>
          <h1 className="text-lg font-semibold">Sign in to Docket</h1>
          <p className="text-sm text-muted-foreground">
            Finlot&rsquo;s AI workforce for loan origination.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 p-6">
          {justReset ? (
            <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Icon name="check_circle" size={15} /> Password updated — sign in with your new password.
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
              <Link href="/forgot" className="text-xs text-muted-foreground hover:text-foreground">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
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
                <Icon name="progress_activity" size={16} className="animate-spin" /> Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        {/* Deliberately pre-auth: the one time production went stale, nobody
            could sign in to check which build was live. */}
        <div className="flex justify-center border-t px-6 py-2.5">
          <BuildMarker />
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}
