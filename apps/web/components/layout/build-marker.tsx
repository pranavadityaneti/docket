"use client";

/**
 * Which build this page came from.
 *
 * Inlined at build time from VERCEL_GIT_COMMIT_SHA (see next.config.ts), so it
 * describes the deployment actually being served rather than whatever is in
 * git. Deliberately rendered on the LOGIN page as well as inside the app:
 * production once sat two days stale, and the person best placed to notice
 * couldn't sign in to check. A staleness indicator locked behind auth is
 * useless in exactly the situation it exists for.
 *
 * Shows "dev" off Vercel, where there is no commit to name.
 */
const SHA = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

export function BuildMarker({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-mono text-[10px] text-muted-foreground/70 ${className}`}
      title={SHA ? `Deployed build ${SHA}` : "Local development build"}
    >
      build {SHA ? SHA.slice(0, 7) : "dev"}
    </span>
  );
}
