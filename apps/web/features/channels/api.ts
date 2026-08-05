import { apiFetch } from "@/lib/http";

export type ApiChannel = {
  id: string;
  kind: "email" | "whatsapp";
  address: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  cursor: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export function listChannels(): Promise<ApiChannel[]> {
  return apiFetch<ApiChannel[]>("/channels");
}

export function pollChannel(channelId: string): Promise<unknown> {
  return apiFetch(`/channels/${encodeURIComponent(channelId)}/poll`, { method: "POST" });
}
