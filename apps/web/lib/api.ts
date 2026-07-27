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

/**
 * POST /auth/forgot-password — start a reset. Pre-auth (no token). Always
 * resolves when the request is accepted; the API never reveals whether the
 * email is registered, so callers must show the same neutral message either way.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

/**
 * POST /auth/reset-password — set a new password with a reset token. Pre-auth.
 * Throws with the API's message on an invalid/expired token (400).
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Reset failed (${res.status})`);
  }
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

/**
 * One case plus the vocabulary of the workflow it belongs to.
 *
 * The labels ride along with the case rather than being looked up separately,
 * so a detail screen never has to guess which workflow it is showing.
 */
export type ApiCaseDetail = ApiCase & {
  workflowId: string;
  workflowName: string;
  workflowSlug: string;
  subjectLabel: string;
  caseLabel: string;
  /** When document requests are paused for this case; null = active. */
  nudgesPausedAt: string | null;
};

/** GET /cases/:id — 404s if the id is not this tenant's. */
export function getCase(caseId: string): Promise<ApiCaseDetail> {
  return apiFetch<ApiCaseDetail>(`/cases/${encodeURIComponent(caseId)}`);
}

/* ------------------------------ document requests (nudges) ------------------------------ */

/** Per-channel result of one send attempt (see apps/api NudgeService). */
export type NudgeChannelResult = { channel: "email" | "whatsapp"; ok: boolean; detail?: string };
/** `sent` is empty and `skipped` set when nothing was sent (complete/paused/no channel/…). */
export type NudgeResult = { sent: NudgeChannelResult[]; skipped?: string };

/** One outbound request or reminder, as shown in the case's Sent history. */
export type ApiCaseMessage = {
  id: string;
  kind: "initial" | "reminder" | "manual";
  channel: "email" | "whatsapp";
  recipient: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
};

/** POST /cases/:id/nudge — send a document request now (manual). */
export function requestDocuments(caseId: string): Promise<NudgeResult> {
  return apiFetch<NudgeResult>(`/cases/${encodeURIComponent(caseId)}/nudge`, { method: "POST" });
}

/** POST /cases/:id/nudges/pause — stop automated reminders for this case. */
export function pauseNudges(caseId: string): Promise<{ id: string; nudgesPausedAt: string | null }> {
  return apiFetch(`/cases/${encodeURIComponent(caseId)}/nudges/pause`, { method: "POST" });
}

/** POST /cases/:id/nudges/resume — re-enable automated reminders. */
export function resumeNudges(
  caseId: string,
): Promise<{ id: string; nudgesPausedAt: string | null }> {
  return apiFetch(`/cases/${encodeURIComponent(caseId)}/nudges/resume`, { method: "POST" });
}

/** GET /cases/:id/messages — the case's outbound history, newest first. */
export function getCaseMessages(caseId: string): Promise<ApiCaseMessage[]> {
  return apiFetch<ApiCaseMessage[]>(`/cases/${encodeURIComponent(caseId)}/messages`);
}

/* ------------------------------ unmatched documents (Needs attention) ------------------------------ */

/** An inbound document that matched no case, waiting for a human to route it. */
export type ApiUnmatchedDocument = {
  id: string;
  channel: "email" | "whatsapp";
  sender: string | null;
  /** Email subject or WhatsApp caption — the clue for where it belongs. */
  context: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  receivedAt: string;
};

/** GET /unmatched — the tenant's pending arrivals, newest first. */
export function listUnmatched(): Promise<ApiUnmatchedDocument[]> {
  return apiFetch<ApiUnmatchedDocument[]>("/unmatched");
}

/** POST /unmatched/:id/assign — file it onto a case (optionally a checklist slot). */
export function assignUnmatched(
  id: string,
  input: { caseId: string; requirementId?: string },
): Promise<{ documentId: string; caseId: string }> {
  return apiFetch(`/unmatched/${encodeURIComponent(id)}/assign`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /unmatched/:id/discard — not ours / junk. The file is kept for audit. */
export function discardUnmatched(id: string, reason?: string): Promise<{ id: string }> {
  return apiFetch(`/unmatched/${encodeURIComponent(id)}/discard`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
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
/**
 * One domain field a workflow collects (mirrors FieldDef in @docket/db).
 *
 * `show_in_table` is why this reaches the client: which domain values earn a
 * column on the Cases table is the workflow's configuration, not this app's
 * guess — a lender's "Loan Type" and a college's "Course" are the same feature.
 */
export type ApiFieldDef = {
  field_key: string;
  label: string;
  field_type: "string" | "integer" | "enum";
  input_type: "text" | "number" | "dropdown" | "textarea";
  required: boolean;
  options?: string[];
  placeholder?: string;
  order: number;
  show_in_table?: boolean;
  /** Display hint: "inr" renders an integer as Indian-format currency. */
  format?: "inr";
};

export type ApiWorkflow = {
  id: string;
  name: string;
  slug: string;
  /** What this workflow calls the party documents come from: Borrower, Student, Client… */
  subjectLabel: string;
  /** What this workflow calls one run of itself: Application, Admission, Engagement… */
  caseLabel: string;
  /** The workflow's domain fields. Empty when it has no field config. */
  fields: ApiFieldDef[];
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

/* ------------------------------- overview ------------------------------- */

export type ApiAttentionItem = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  stageName: string | null;
  outstanding: number;
  awaitingReview: number;
  updatedAt: string;
};

export type ApiOverview = {
  totals: {
    cases: number;
    casesNeedingAttention: number;
    casesComplete: number;
    documentsAwaitingReview: number;
    documentsOutstanding: number;
  };
  attention: ApiAttentionItem[];
  /** Live document counts keyed by how they arrived: upload, whatsapp, email… */
  intake: Record<string, number>;
};

/**
 * Real counts for the Overview screen.
 *
 * Derived from rows on every request. The screen shows nothing this does not
 * return — no call volumes, no "documents auto-cleared", no trend arrows —
 * because none of those exist to be measured yet.
 */
export function getOverview(): Promise<ApiOverview> {
  return apiFetch<ApiOverview>("/overview");
}

/* ------------------------------- documents ------------------------------- */

export type DocumentStatus = "received" | "needs_review" | "accepted" | "rejected" | "expired";
export type ChecklistItemStatus = DocumentStatus | "missing";

export type ApiDocument = {
  id: string;
  fileName: string;
  status: DocumentStatus;
  rejectionReason: string | null;
  sizeBytes: number | null;
  sourceChannel: string | null;
  receivedAt: string;
  /** False while a row is reserved but the bytes have not landed. */
  uploaded: boolean;
};

export type ApiChecklistItem = {
  requirementId: string;
  key: string;
  label: string;
  description: string | null;
  required: boolean;
  maxFiles: number;
  /** Files still holding a slot — rejected/expired/never-uploaded excluded. */
  slotsUsed: number;
  /**
   * Whether another file may be added. Comes from the API, which enforces the
   * same rule on upload. Never re-derive this from documents.length: a rejected
   * document still appears in the list but no longer occupies a slot, so
   * counting rows would block the replacement the rejection is asking for.
   */
  canUpload: boolean;
  /** Can be carried forward from the subject's other cases. */
  reusable: boolean;
  /** Days an accepted document stays valid; null = indefinitely. */
  validityDays: number | null;
  status: ChecklistItemStatus;
  documents: ApiDocument[];
};

export type ApiChecklist = {
  caseId: string;
  items: ApiChecklistItem[];
  /** Arrived but matching no requirement — for a human to place. */
  unclassified: Pick<ApiDocument, "id" | "fileName" | "status" | "sourceChannel" | "receivedAt">[];
  summary: { required: number; accepted: number; outstanding: number; awaitingReview: number };
};

/**
 * What this case still needs.
 *
 * Conditions are resolved server-side, so this is the same answer the WhatsApp
 * bot and the voice bot will get. The dashboard deliberately does not evaluate
 * requirement rules itself — a second implementation is a second answer.
 */
export function getChecklist(caseId: string): Promise<ApiChecklist> {
  return apiFetch<ApiChecklist>(`/cases/${encodeURIComponent(caseId)}/checklist`);
}

type UploadTarget = { url: string; method: string; headers: Record<string, string>; expiresIn: number };

/**
 * The raw document row, as the write endpoints return it.
 *
 * Deliberately NOT ApiDocument: the checklist projects a derived `uploaded`
 * flag that the underlying row does not have. Typing these as ApiDocument would
 * promise a field that is never sent. Callers refetch the checklist after a
 * write rather than patching state from this.
 */
export type ApiDocumentRow = {
  id: string;
  caseId: string;
  requirementId: string | null;
  fileName: string;
  status: DocumentStatus;
  rejectionReason: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
};

/**
 * Upload a file against a checklist item.
 *
 * Three steps, because the middle one goes straight to object storage and never
 * touches our API: reserve a row and get a target, PUT the bytes there, then
 * confirm — at which point the API reads size and checksum back from storage
 * rather than trusting anything the browser claims.
 */
export async function uploadDocument(
  caseId: string,
  file: File,
  requirementId?: string,
): Promise<ApiDocumentRow> {
  const begun = await apiFetch<{ documentId: string; upload: UploadTarget }>(
    `/cases/${encodeURIComponent(caseId)}/documents`,
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || undefined,
        requirementId,
      }),
    },
  );

  const res = await fetch(begun.upload.url, {
    method: begun.upload.method,
    headers: begun.upload.headers,
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}). The link may have expired — try again.`);
  }

  return apiFetch<ApiDocumentRow>(`/documents/${encodeURIComponent(begun.documentId)}/complete`, {
    method: "POST",
  });
}

/**
 * Remove a document: the stored file is purged, the record is kept.
 *
 * Irreversible — the file is gone, not archived. What survives is a row marked
 * removed, carrying the file name, checksum and who removed it, so the removal
 * itself stays answerable.
 */
export function removeDocument(documentId: string, reason?: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

/** Accept a document, or reject it with a reason the subject will be told. */
export function reviewDocument(
  documentId: string,
  status: "accepted" | "rejected" | "needs_review",
  rejectionReason?: string,
): Promise<ApiDocumentRow> {
  return apiFetch<ApiDocumentRow>(`/documents/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, rejectionReason }),
  });
}
