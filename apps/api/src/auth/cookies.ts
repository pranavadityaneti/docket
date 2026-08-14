import type { Request, Response } from "express";
import { env } from "../config/env";

/** HttpOnly JWT cookie - never readable by page JS. Tenant staff sessions. */
export const AUTH_COOKIE = "docket_token";
/**
 * Non-secret presence marker (not HttpOnly) so the browser and Next middleware
 * can tell a session exists without exposing the JWT.
 */
export const SESSION_COOKIE = "docket_session";

/** Platform super-admin session - separate from tenant cookies on purpose. */
export const ADMIN_AUTH_COOKIE = "docket_admin_token";
export const ADMIN_SESSION_COOKIE = "docket_admin_session";

const MAX_AGE_SEC = 7 * 24 * 60 * 60;

function cookieFlags(httpOnly: boolean): string {
  // SameSite=Lax is correct when the web app and API share an origin via the
  // Next rewrite (/api → API). Cross-site cookie auth would need None+Secure.
  const parts = [`Path=/`, `Max-Age=${MAX_AGE_SEC}`, `SameSite=Lax`];
  if (httpOnly) parts.push("HttpOnly");
  if (env.isProd) parts.push("Secure");
  return parts.join("; ");
}

export function setAuthCookies(res: Response, token: string): void {
  res.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(true)}`,
  );
  res.append("Set-Cookie", `${SESSION_COOKIE}=1; ${cookieFlags(false)}`);
}

export function clearAuthCookies(res: Response): void {
  const clear = `Path=/; Max-Age=0; SameSite=Lax${env.isProd ? "; Secure" : ""}`;
  res.append("Set-Cookie", `${AUTH_COOKIE}=; HttpOnly; ${clear}`);
  res.append("Set-Cookie", `${SESSION_COOKIE}=; ${clear}`);
}

export function setAdminAuthCookies(res: Response, token: string): void {
  res.append(
    "Set-Cookie",
    `${ADMIN_AUTH_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(true)}`,
  );
  res.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=1; ${cookieFlags(false)}`);
}

export function clearAdminAuthCookies(res: Response): void {
  const clear = `Path=/; Max-Age=0; SameSite=Lax${env.isProd ? "; Secure" : ""}`;
  res.append("Set-Cookie", `${ADMIN_AUTH_COOKIE}=; HttpOnly; ${clear}`);
  res.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; ${clear}`);
}

export function extractAdminAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return readCookie(req, ADMIN_AUTH_COOKIE);
}

/** Read a single cookie value from the raw Cookie header (no cookie-parser). */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
}

/**
 * Bearer header wins when present (scripts / integrations); otherwise the
 * httpOnly session cookie. Browser staff sessions should use the cookie only.
 */
export function extractAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return readCookie(req, AUTH_COOKIE);
}
