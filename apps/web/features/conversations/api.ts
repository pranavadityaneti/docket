import { apiFetch } from "@/lib/http";

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

export function listConversations(): Promise<ApiConversationThread[]> {
  return apiFetch<ApiConversationThread[]>("/conversations");
}
