import { apiFetch, apiFetchBlob } from "@/lib/http";
import type { ApiCase } from "@/features/cases/api";

export type ApiCaseDetail = ApiCase & {
  workflowId: string;
  workflowName: string;
  workflowSlug: string;
  subjectLabel: string;
  caseLabel: string;
  nudgesPausedAt: string | null;
};

export type NudgeChannelResult = { channel: "email" | "whatsapp"; ok: boolean; detail?: string };
export type NudgeResult = { sent: NudgeChannelResult[]; skipped?: string };

export type ApiCaseMessage = {
  id: string;
  kind: "initial" | "reminder" | "manual";
  channel: "email" | "whatsapp";
  recipient: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
};

export type ApiCaseEvent = {
  id: string;
  kind: "comment" | "stage_changed" | "document_reviewed";
  requirementId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type ApiConversationAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
};

export type ApiConversationEntry = {
  id: string;
  channel: "email" | "whatsapp";
  direction: "inbound" | "outbound";
  counterpart: string;
  subject: string | null;
  body: string;
  kind: string | null;
  failed: boolean;
  at: string;
  attachments: ApiConversationAttachment[];
};

export type DocumentStatus = "received" | "needs_review" | "accepted" | "rejected" | "expired";
export type ChecklistItemStatus = DocumentStatus | "missing";
export type ClassificationConfidence = "high" | "medium" | "low";

export type ApiDocument = {
  id: string;
  fileName: string;
  mimeType: string | null;
  status: DocumentStatus;
  rejectionReason: string | null;
  sizeBytes: number | null;
  sourceChannel: string | null;
  receivedAt: string;
  uploaded: boolean;
  autoFiled: boolean;
  classifiedType: string | null;
  classificationConfidence: ClassificationConfidence | null;
};

export type ApiUnclassifiedDocument = Pick<
  ApiDocument,
  | "id"
  | "fileName"
  | "mimeType"
  | "status"
  | "sourceChannel"
  | "receivedAt"
  | "uploaded"
  | "classifiedType"
  | "classificationConfidence"
> & {
  suggestedRequirementId: string | null;
  suggestedLabel: string | null;
};

export type ApiChecklistItem = {
  requirementId: string;
  key: string;
  label: string;
  description: string | null;
  required: boolean;
  maxFiles: number;
  slotsUsed: number;
  canUpload: boolean;
  reusable: boolean;
  validityDays: number | null;
  status: ChecklistItemStatus;
  documents: ApiDocument[];
};

export type ApiChecklist = {
  caseId: string;
  items: ApiChecklistItem[];
  unclassified: ApiUnclassifiedDocument[];
  summary: { required: number; accepted: number; outstanding: number; awaitingReview: number };
};

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

type UploadTarget = { url: string; method: string; headers: Record<string, string>; expiresIn: number };

export function getCase(caseId: string): Promise<ApiCaseDetail> {
  return apiFetch<ApiCaseDetail>(`/cases/${encodeURIComponent(caseId)}`);
}

export function getCaseEvents(caseId: string): Promise<ApiCaseEvent[]> {
  return apiFetch<ApiCaseEvent[]>(`/cases/${encodeURIComponent(caseId)}/events`);
}

export function addCaseComment(
  caseId: string,
  body: string,
  requirementId?: string,
): Promise<ApiCaseEvent> {
  return apiFetch<ApiCaseEvent>(`/cases/${encodeURIComponent(caseId)}/comments`, {
    method: "POST",
    body: JSON.stringify(requirementId ? { body, requirementId } : { body }),
  });
}

export function getCaseConversation(caseId: string): Promise<ApiConversationEntry[]> {
  return apiFetch<ApiConversationEntry[]>(`/cases/${encodeURIComponent(caseId)}/conversation`);
}

export function requestDocuments(caseId: string): Promise<NudgeResult> {
  return apiFetch<NudgeResult>(`/cases/${encodeURIComponent(caseId)}/nudge`, { method: "POST" });
}

export function pauseNudges(caseId: string): Promise<{ id: string; nudgesPausedAt: string | null }> {
  return apiFetch(`/cases/${encodeURIComponent(caseId)}/nudges/pause`, { method: "POST" });
}

export function resumeNudges(
  caseId: string,
): Promise<{ id: string; nudgesPausedAt: string | null }> {
  return apiFetch(`/cases/${encodeURIComponent(caseId)}/nudges/resume`, { method: "POST" });
}

export function getCaseMessages(caseId: string): Promise<ApiCaseMessage[]> {
  return apiFetch<ApiCaseMessage[]>(`/cases/${encodeURIComponent(caseId)}/messages`);
}

export function getChecklist(caseId: string): Promise<ApiChecklist> {
  return apiFetch<ApiChecklist>(`/cases/${encodeURIComponent(caseId)}/checklist`);
}

export function confirmSuggestion(documentId: string): Promise<{ id: string }> {
  return apiFetch(`/documents/${encodeURIComponent(documentId)}/suggestion/confirm`, {
    method: "POST",
  });
}

export function dismissSuggestion(documentId: string): Promise<{ id: string }> {
  return apiFetch(`/documents/${encodeURIComponent(documentId)}/suggestion/dismiss`, {
    method: "POST",
  });
}

export function reclassifyDocument(documentId: string): Promise<{ id: string }> {
  return apiFetch(`/documents/${encodeURIComponent(documentId)}/reclassify`, {
    method: "POST",
  });
}

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
    throw new Error(`Upload failed (${res.status}). The link may have expired - try again.`);
  }

  return apiFetch<ApiDocumentRow>(`/documents/${encodeURIComponent(begun.documentId)}/complete`, {
    method: "POST",
  });
}

export function removeDocument(documentId: string, reason?: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

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

export function fetchDocumentContent(documentId: string): Promise<Blob> {
  return apiFetchBlob(`/documents/${encodeURIComponent(documentId)}/content`);
}
