import { apiFetch } from "@/lib/http";
import type { PageResult } from "@/features/shared/types";

export type { PageResult } from "@/features/shared/types";

export type ApiConversationThread = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  channel: "email" | "whatsapp";
  direction: "inbound" | "outbound";
  preview: string;
  at: string;
  inboundCount: number;
};

export type ListConversationsOpts = {
  limit?: number;
  offset?: number;
};

function conversationsQuery(opts: ListConversationsOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listConversations(
  opts: ListConversationsOpts = {},
): Promise<PageResult<ApiConversationThread>> {
  return apiFetch<PageResult<ApiConversationThread>>(
    `/conversations${conversationsQuery(opts)}`,
  );
}
