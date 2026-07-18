// API client for the Docket NestJS API (apps/api).
//
// Token storage is a client-side JWT in localStorage, sent as a Bearer header.
// (A first hardening pass; moving to an httpOnly cookie is tracked separately.)
//
// Overridable via env:
//   NEXT_PUBLIC_API_URL  (default http://localhost:3333)

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const TOKEN_KEY = "docket_token";

/** Thrown when a request has no token, or the API rejects the token as invalid/expired. */
export class AuthRequiredError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "AuthRequiredError";
  }
}

/**
 * Dispatched on `window` when the API rejects our token (expired/revoked).
 * AppChrome listens and redirects, so no individual page has to implement its
 * own 401 handling. An event keeps this module free of React/router imports.
 */
export const AUTH_REQUIRED_EVENT = "docket:auth-required";

/**
 * Shape returned by GET /cases (see apps/api/src/cases/cases.ts list()).
 * Domain values — loan amount, course applied for, claim number — arrive in
 * `data`, described by the workflow's field config. Nothing here is
 * industry-specific, which is what lets one dashboard serve a lender, a
 * college and a CA firm.
 */
export type ApiCase = {
  id: string;
  reference: string;
  source: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  subjectEmail: string | null;
  subjectPhone: string | null;
  stageId: string | null;
  stageName: string | null;
  stageTone: string | null;
};

function getToken(): string {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
  if (!token) throw new AuthRequiredError();
  return token;
}

function clearToken() {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

/** True if a token is cached — a cheap presence check, not a validity check (the API is authoritative). */
export function isLoggedIn(): boolean {
  return typeof window !== "undefined" && !!window.localStorage.getItem(TOKEN_KEY);
}

export type LoginProfile = {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string; slug: string };
  role: string;
};

/** POST /auth/login — on success, caches the token and returns the profile (not the raw token). */
export async function login(email: string, password: string): Promise<LoginProfile> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `Login failed (${res.status})`);
  const { token, ...profile } = body as LoginProfile & { token: string };
  window.localStorage.setItem(TOKEN_KEY, token);
  return profile;
}

export function logout(): void {
  clearToken();
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
      authorization: `Bearer ${getToken()}`,
    },
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}) ${body}`.trim());
  }
  return (await res.json()) as T;
}

/**
 * All cases for a workflow, newest first. `workflow` is optional — when a
 * workspace runs exactly one, the API resolves it, so the client no longer
 * hardcodes a lending slug.
 */
export function listCases(workflow?: string): Promise<ApiCase[]> {
  const qs = workflow ? `?workflow=${encodeURIComponent(workflow)}` : "";
  return apiFetch<ApiCase[]>(`/cases${qs}`);
}

/** Fields accepted by POST /cases (mirrors apps/api CreateCaseDto). */
export type CreateCaseInput = {
  /** The subject: borrower, student, client — whoever documents come from. */
  name: string;
  organisation?: string;
  email?: string;
  phone?: string;
  source?: string;
  workflow?: string;
  /** Domain fields keyed as the workflow's field config defines them. */
  data?: Record<string, unknown>;
};

/** Create a case; the API places it at the workflow's first stage and returns the row. */
export function createCase(input: CreateCaseInput): Promise<{ id: string; reference: string }> {
  return apiFetch<{ id: string; reference: string }>("/cases", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Shape returned by GET /workflows/:slug/stages. */
export type ApiStage = {
  id: string;
  name: string;
  tone: string;
  position: number;
};

/** Shape returned by GET /workflows — the tenant's processes and their vocabulary. */
export type ApiWorkflow = {
  id: string;
  name: string;
  slug: string;
  /** What this workflow calls the party documents come from: Borrower, Student, Client… */
  subjectLabel: string;
  /** What this workflow calls one run of itself: Application, Admission, Engagement… */
  caseLabel: string;
};

/** The tenant's workflows. The client must not assume which one exists. */
export function listWorkflows(): Promise<ApiWorkflow[]> {
  return apiFetch<ApiWorkflow[]>("/workflows");
}

/**
 * All stages for a workflow, ordered by board position.
 *
 * `workflow` is deliberately REQUIRED. It previously defaulted to
 * "business-loan", so a caller passing nothing silently requested a lending
 * workflow — which does not exist for a college or a CA firm.
 */
export function listStages(workflow: string): Promise<ApiStage[]> {
  return apiFetch<ApiStage[]>(`/workflows/${encodeURIComponent(workflow)}/stages`);
}

/** Move a case to another stage (PATCH /cases/:id/stage). Validated server-side. */
export function updateCaseStage(caseId: string, stageId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/cases/${encodeURIComponent(caseId)}/stage`, {
    method: "PATCH",
    body: JSON.stringify({ stageId }),
  });
}
