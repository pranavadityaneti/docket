import type { ApiConversationEntry } from "@/features/case-detail/api";

/** Latest customer message wins — reply rides that same medium. */
export function preferredReplyChannel(
  entries: ApiConversationEntry[],
): "email" | "whatsapp" | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.direction === "inbound") return entries[i]!.channel;
  }
  return null;
}
