import type { NextConfig } from "next";

/**
 * Which build is live, visible in the app.
 *
 * Production sat two days stale once and nothing said so — it was only caught
 * by noticing a route 404 and working backwards through which pages existed.
 * Vercel sets VERCEL_GIT_COMMIT_SHA at build time, but a plain env var never
 * reaches the browser, so it is inlined here as NEXT_PUBLIC_COMMIT_SHA and
 * rendered in the UI. "Is production current?" then costs one glance instead of
 * an investigation.
 *
 * Empty off Vercel (local dev), where the UI shows "dev" instead.
 */
const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
