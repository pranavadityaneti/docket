import { apiFetch } from "@/lib/http";
import type { PageResult } from "@/features/shared/types";

export type { PageResult } from "@/features/shared/types";

export type ApiUnmatchedDocument = {
  id: string;
  channel: "email" | "whatsapp";
  sender: string | null;
  context: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  receivedAt: string;
};

export type ListUnmatchedOpts = {
  limit?: number;
  offset?: number;
};

function unmatchedQuery(opts: ListUnmatchedOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listUnmatched(
  opts: ListUnmatchedOpts = {},
): Promise<PageResult<ApiUnmatchedDocument>> {
  return apiFetch<PageResult<ApiUnmatchedDocument>>(
    `/unmatched${unmatchedQuery(opts)}`,
  );
}

export function assignUnmatched(
  id: string,
  input: { caseId: string; requirementId?: string },
): Promise<{ documentId: string; caseId: string }> {
  return apiFetch(`/unmatched/${encodeURIComponent(id)}/assign`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function discardUnmatched(id: string, reason?: string): Promise<{ id: string }> {
  return apiFetch(`/unmatched/${encodeURIComponent(id)}/discard`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
