import { apiFetch } from "@/lib/http";
import type { BulkDeleteResult, PageResult } from "@/features/shared/types";

export type { BulkDeleteResult, PageResult } from "@/features/shared/types";

/**
 * Shape returned by GET /cases.
 * Domain values arrive in `data`, described by the workflow's field config.
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
  ownerId: string | null;
  ownerName: string | null;
};

export type CreateCaseInput = {
  name: string;
  organisation?: string;
  email?: string;
  phone?: string;
  source?: string;
  workflow?: string;
  data?: Record<string, unknown>;
};

export type UpdateCaseInput = {
  name?: string;
  organisation?: string | null;
  email?: string | null;
  phone?: string | null;
  data?: Record<string, unknown>;
  ownerId?: string | null;
};

export type CaseDeletePreview = {
  cases: { id: string; reference: string; subjectName: string | null; documentCount: number }[];
  documentCount: number;
};

export type ListCasesOpts = {
  workflow?: string;
  limit?: number;
  offset?: number;
};

function casesQuery(opts: ListCasesOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.workflow) params.set("workflow", opts.workflow);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listCases(opts: ListCasesOpts = {}): Promise<PageResult<ApiCase>> {
  return apiFetch<PageResult<ApiCase>>(`/cases${casesQuery(opts)}`);
}

/** Walk pages until exhausted - for pickers / board that need the full set. */
export async function listAllCases(
  workflow?: string,
  pageSize = 200,
): Promise<ApiCase[]> {
  const all: ApiCase[] = [];
  let offset = 0;
  for (;;) {
    const page = await listCases({ workflow, limit: pageSize, offset });
    all.push(...page.items);
    offset += page.limit;
    if (all.length >= page.total || page.items.length === 0) break;
  }
  return all;
}

export function createCase(input: CreateCaseInput): Promise<{ id: string; reference: string }> {
  return apiFetch<{ id: string; reference: string }>("/cases", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCase(caseId: string, input: UpdateCaseInput): Promise<ApiCase> {
  return apiFetch<ApiCase>(`/cases/${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateCaseStage(caseId: string, stageId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/cases/${encodeURIComponent(caseId)}/stage`, {
    method: "PATCH",
    body: JSON.stringify({ stageId }),
  });
}

export function previewDeleteCases(ids: string[]): Promise<CaseDeletePreview> {
  return apiFetch<CaseDeletePreview>("/cases/delete-preview", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function deleteCases(ids: string[]): Promise<BulkDeleteResult> {
  return apiFetch<BulkDeleteResult>("/cases/delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

/** Exported for unit tests - builds the cases list query string. */
export { casesQuery as buildCasesQuery };
