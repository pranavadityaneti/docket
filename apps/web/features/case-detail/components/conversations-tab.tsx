"use client";

import { SegmentedControl } from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { ApiConversationEntry } from "@/features/case-detail/api";
import { formatDateTime } from "@/lib/format";
import * as React from "react";
import { AttachmentTile } from "./attachment-tile";
import { ChatMarkdown } from "./chat-markdown";
import { CHANNEL_LABEL, MESSAGE_KIND_LABEL, type PreviewTarget } from "./meta";
import { preferredReplyChannel } from "./preferred-reply-channel";

export { preferredReplyChannel } from "./preferred-reply-channel";

function ReplyComposer({
  preferredChannel,
  onSend,
}: {
  preferredChannel: "email" | "whatsapp" | null;
  onSend: (body: string, channel: "email" | "whatsapp") => Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [channel, setChannel] = React.useState<"email" | "whatsapp">(
    preferredChannel ?? "email",
  );

  React.useEffect(() => {
    if (preferredChannel) setChannel(preferredChannel);
  }, [preferredChannel]);

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSend(body, channel);
      setText("");
    } catch {
      // Caller surfaces the error; keep the draft.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Reply via</span>
        <SegmentedControl
          aria-label="Reply channel"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "email", label: CHANNEL_LABEL.email, icon: "mail" },
            { value: "whatsapp", label: CHANNEL_LABEL.whatsapp, icon: "chat" },
          ]}
        />
        {preferredChannel ? (
          <span className="text-muted-foreground/80">
            · same as last customer message ({CHANNEL_LABEL[preferredChannel]})
          </span>
        ) : (
          <span className="text-muted-foreground/80">
            · no customer message yet — pick a channel
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={`Message via ${CHANNEL_LABEL[channel]}...`}
          className="min-h-[2.75rem] w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          disabled={busy}
        />
        <Button
          size="sm"
          className="shrink-0"
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}

export function ConversationsTab({
  entries,
  subject,
  onPreview,
  onReply,
}: {
  entries: ApiConversationEntry[];
  subject: string;
  onPreview: (doc: PreviewTarget) => void;
  onReply: (body: string, channel: "email" | "whatsapp") => Promise<void>;
}) {
  const [channel, setChannel] = React.useState<"all" | "email" | "whatsapp">("all");
  const preferredChannel = preferredReplyChannel(entries);
  const shown = entries.filter(
    (entry) => channel === "all" || entry.channel === channel,
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <div className="font-medium">Conversations</div>
          <p className="text-sm text-muted-foreground">
            Every message exchanged with this {subject.toLowerCase()}.
          </p>
        </div>
        <SegmentedControl
          role="tablist"
          aria-label="Filter by channel"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "all", label: "All" },
            { value: "email", label: CHANNEL_LABEL.email, icon: "mail" },
            { value: "whatsapp", label: CHANNEL_LABEL.whatsapp, icon: "chat" },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <div className="p-10 text-center">
          <div className="text-sm font-medium">No messages yet</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {channel === "whatsapp"
              ? "WhatsApp messages will appear here once the number is connected."
              : `Messages with this ${subject.toLowerCase()} will appear here as they arrive.`}
          </p>
        </div>
      ) : (
        <div className="flex max-h-[min(28rem,55vh)] flex-col gap-3 overflow-y-auto p-4">
          {shown.map((message) => {
            const attachments = message.attachments ?? [];
            return (
              <div
                key={message.id}
                className={`flex w-full ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg border px-3 py-2 ${message.direction === "outbound"
                      ? "rounded-br-sm bg-primary/10 dark:bg-primary/20"
                      : "rounded-bl-sm bg-muted/60"
                    }`}
                >
                  <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon
                      name={message.channel === "whatsapp" ? "chat" : "mail"}
                      size={12}
                    />
                    {message.direction === "outbound" ? "To" : "From"}{" "}
                    {message.counterpart}
                    {message.kind
                      ? ` · ${MESSAGE_KIND_LABEL[message.kind] ?? message.kind}`
                      : ""}
                    {message.failed ? (
                      <span className="font-medium text-danger">· failed</span>
                    ) : null}
                  </div>
                  {message.subject ? (
                    <div className="mb-0.5 text-sm font-medium">{message.subject}</div>
                  ) : null}
                  {message.body ? <ChatMarkdown text={message.body} /> : null}
                  {attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {attachments.map((file) => (
                        <AttachmentTile
                          key={file.id}
                          file={file}
                          onPreview={onPreview}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-1 text-right text-[11px] text-muted-foreground/70">
                    {formatDateTime(message.at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ReplyComposer preferredChannel={preferredChannel} onSend={onReply} />
    </Card>
  );
}

export function CallsPlaceholder({ subject }: { subject: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon name="call" size={22} className="text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">Calls are coming soon</div>
      <p className="max-w-sm px-4 text-sm text-muted-foreground">
        Calls with the {subject.toLowerCase()} will appear here - outcomes, notes
        and recordings, alongside every other touchpoint on the case.
      </p>
    </Card>
  );
}
