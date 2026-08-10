import { describe, expect, it } from "vitest";
import type { ApiConversationEntry } from "@/features/case-detail/api";
import { preferredReplyChannel } from "@/features/case-detail/components/preferred-reply-channel";

function entry(
  partial: Pick<ApiConversationEntry, "channel" | "direction"> & { id?: string },
): ApiConversationEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    channel: partial.channel,
    direction: partial.direction,
    counterpart: "x",
    subject: null,
    body: "hi",
    kind: null,
    failed: false,
    at: new Date().toISOString(),
    attachments: [],
  };
}

describe("preferredReplyChannel", () => {
  it("uses the latest inbound channel, ignoring later outbound", () => {
    const entries = [
      entry({ channel: "email", direction: "inbound", id: "1" }),
      entry({ channel: "whatsapp", direction: "inbound", id: "2" }),
      entry({ channel: "email", direction: "outbound", id: "3" }),
    ];
    expect(preferredReplyChannel(entries)).toBe("whatsapp");
  });

  it("returns null when nothing inbound yet", () => {
    expect(
      preferredReplyChannel([
        entry({ channel: "email", direction: "outbound" }),
      ]),
    ).toBeNull();
  });
});
