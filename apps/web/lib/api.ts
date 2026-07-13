// Dev-time client for the Docket NestJS API (apps/api).
//
// ⚠️ AUTH IS A DEV STOPGAP. The API's POST /auth/login currently issues a JWT
// from an email alone (no password) — a dev simplification — so this client
// auto-logs-in as the seeded admin to obtain a token and caches it. Replace
// with a real login flow (its own phase) before any non-local deployment.
//
// Overridable via env:
//   NEXT_PUBLIC_API_URL          (default http://localhost:3333)
//   NEXT_PUBLIC_DEV_LOGIN_EMAIL  (default admin@finlot.ai)

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
const DEV_EMAIL = process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL ?? "admin@finlot.ai";
const TOKEN_KEY = "docket_dev_token";

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

let tokenPromise: Promise<string> | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: DEV_EMAIL }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const json = (await res.json()) as { token: string };
  if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, json.token);
  return json.token;
}

function getToken(): Promise<string> {
  if (typeof window !== "undefined") {
    const cached = window.localStorage.getItem(TOKEN_KEY);
    if (cached) return Promise.resolve(cached);
  }
  if (!tokenPromise) {
    tokenPromise = login().catch((err) => {
      tokenPromise = null; // let the next call retry a failed login
      throw err;
    });
  }
  return tokenPromise;
}

function clearToken() {
  tokenPromise = null;
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = (token: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });

  let res = await doFetch(await getToken());
  if (res.status === 401) {
    // Token stale/invalid — drop it, log in fresh, retry once.
    clearToken();
    res = await doFetch(await getToken());
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
