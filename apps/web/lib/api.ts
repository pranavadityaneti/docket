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

/** Shape returned by GET /leads (see apps/api/src/leads/leads.ts list()). */
export type ApiLead = {
  id: string;
  amount: number | null;
  loanType: string | null;
  entityType: string | null;
  source: string | null;
  monthlyTurnover: number | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  contactName: string | null;
  contactCompany: string | null;
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
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}) ${body}`.trim());
  }
  return (await res.json()) as T;
}

/** All leads for a workflow, newest first. */
export function listLeads(workflow = "business-loan"): Promise<ApiLead[]> {
  return apiFetch<ApiLead[]>(`/leads?workflow=${encodeURIComponent(workflow)}`);
}

/** Fields accepted by POST /leads (mirrors apps/api CreateLeadInput). */
export type CreateLeadInput = {
  name: string;
  company?: string;
  pan?: string;
  loanType?: string;
  entityType?: string;
  amount?: number;
  monthlyTurnover?: number;
  source?: string;
  fundsNeeded?: string;
  workflow?: string;
};

/** Create a lead; the API inserts it at the Pending stage and returns the row. */
export function createLead(input: CreateLeadInput): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/leads", {
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

/** All stages for a workflow, ordered by board position. */
export function listStages(workflow = "business-loan"): Promise<ApiStage[]> {
  return apiFetch<ApiStage[]>(`/workflows/${encodeURIComponent(workflow)}/stages`);
}

/** Move a lead to another stage (PATCH /leads/:id/stage). Validated server-side. */
export function updateLeadStage(leadId: string, stageId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/leads/${encodeURIComponent(leadId)}/stage`, {
    method: "PATCH",
    body: JSON.stringify({ stageId }),
  });
}
