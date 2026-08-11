/**
 * HTTP + session primitives for the Docket NestJS API.
 *
 * Staff sessions use an httpOnly cookie set by POST /auth/login. The browser
 * talks to the API through the Next same-origin rewrite (`/api/*`), so the
 * cookie is first-party. XSS cannot read the JWT.
 *
 * Overridable:
 *   NEXT_PUBLIC_API_URL  - default `/api` (proxied). Point at a full origin
 *                          only for non-browser clients.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/+$/, "");

const PROFILE_KEY = "docket_profile";
/** Readable presence cookie - mirrors httpOnly JWT without exposing it. */
export const SESSION_COOKIE = "docket_session";

/** Thrown when a request has no session, or the API rejects it as invalid/expired. */
export class AuthRequiredError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "AuthRequiredError";
  }
}

/**
 * Dispatched on `window` when the API rejects our session (expired/revoked).
 * App chrome listens and redirects.
 */
export const AUTH_REQUIRED_EVENT = "docket:auth-required";

function readBrowserCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  if (!match) return undefined;
  return decodeURIComponent(match.slice(name.length + 1));
}

/** True if the presence cookie is set - not a validity check (API is authoritative). */
export function isLoggedIn(): boolean {
  return readBrowserCookie(SESSION_COOKIE) === "1";
}

/** Drop the readable presence cookie so Next middleware will allow /login. */
function clearPresenceCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function clearSession(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PROFILE_KEY);
    clearPresenceCookie();
  }
}

export type LoginProfile = {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string; slug: string };
  role: string;
};

export function writeProfile(profile: LoginProfile): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }
}

export function getStoredProfile(): LoginProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LoginProfile;
  } catch {
    return null;
  }
}

const CREDENTIALS: RequestCredentials = "include";

function emitAuthRequired(): void {
  clearSession();
  if (typeof window !== "undefined") {
    // Clear the httpOnly JWT without going through apiFetch (would re-enter
    // this 401 path). Logout itself is unauthenticated - it only clears cookies.
    void fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: CREDENTIALS,
    }).catch(() => {});
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
}

export function friendlyErrorMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim() !== "") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message) && parsed.message.length > 0) {
      return parsed.message.join(". ");
    }
  } catch {
    // Not JSON.
  }
  return fallback;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: CREDENTIALS,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    emitAuthRequired();
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      friendlyErrorMessage(
        body,
        `${init.method ?? "GET"} ${path} failed (${res.status}) ${body}`.trim(),
      ),
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiFetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: CREDENTIALS,
  });
  if (res.status === 401) {
    emitAuthRequired();
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(friendlyErrorMessage(body, `Could not load the file (${res.status})`));
  }
  return res.blob();
}

export async function publicJsonFetch<T>(
  path: string,
  body: unknown,
  fallbackError: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : `${fallbackError} (${res.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

export async function publicPost(path: string, body: unknown, fallbackError: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    const message =
      parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : `${fallbackError} (${res.status})`;
    throw new Error(message);
  }
}
