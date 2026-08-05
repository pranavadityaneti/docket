import { apiFetch } from "@/lib/http";

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

export function listUnmatched(): Promise<ApiUnmatchedDocument[]> {
  return apiFetch<ApiUnmatchedDocument[]>("/unmatched");
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
