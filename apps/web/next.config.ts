import type { NextConfig } from "next";

/**
 * Which build is live, visible in the app.
 *
 * Production sat two days stale once and nothing said so - it was only caught
 * by noticing a route 404 and working backwards through which pages existed.
 * Vercel sets VERCEL_GIT_COMMIT_SHA at build time, but a plain env var never
 * reaches the browser, so it is inlined here as NEXT_PUBLIC_COMMIT_SHA and
 * rendered in the UI.
 */
const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

/**
 * Same-origin API proxy. Browser calls `/api/...`; Next forwards to the Nest
 * API. That keeps the httpOnly session cookie first-party (required for
 * SameSite=Lax) instead of bouncing localhost:3000 → localhost:3333.
 */
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? "http://localhost:3333").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
