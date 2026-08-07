"use client";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type {
  ApiConversationAttachment,
  ApiConversationEntry,
} from "@/features/case-detail/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as React from "react";
import { CHANNEL_LABEL, MESSAGE_KIND_LABEL, type PreviewTarget } from "./meta";

function attachmentIcon(mimeType: string | null, fileName: string): string {
  const mime = (mimeType ?? "").toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "picture_as_pdf";
  return "attach_file";
}

function AttachmentChip({
  file,
  onPreview,
}: {
  file: ApiConversationAttachment;
  onPreview: (doc: PreviewTarget) => void;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onPreview({
          id: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
        })
      }
      className="inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-border/80 bg-background px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
      title={`Preview ${file.fileName}`}
    >
      <Icon
        name={attachmentIcon(file.mimeType, file.fileName)}
        size={14}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate font-medium">{file.fileName}</span>
      <Icon name="visibility" size={12} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

export function ConversationsTab({
  entries,
  subject,
  onPreview,
}: {
  entries: ApiConversationEntry[];
  subject: string;
  onPreview: (doc: PreviewTarget) => void;
}) {
  const [channel, setChannel] = React.useState<"all" | "email" | "whatsapp">("all");
  const shown = entries.filter(
    (entry) => channel === "all" || entry.channel === channel,
  );
  const options = [
    { id: "all" as const, label: "All" },
    { id: "email" as const, label: CHANNEL_LABEL.email, icon: "mail" },
    { id: "whatsapp" as const, label: CHANNEL_LABEL.whatsapp, icon: "chat" },
  ] as const;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <div className="font-medium">Conversations</div>
          <p className="text-sm text-muted-foreground">
            Every message exchanged with this {subject.toLowerCase()}.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Filter by channel"
          className="inline-flex h-9 items-center rounded-[8px] border border-border/80 bg-muted/60 p-0.5"
        >
          {options.map((option) => {
            const active = channel === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setChannel(option.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {"icon" in option ? <Icon name={option.icon} size={14} /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
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
        <div className="flex flex-col gap-3 p-4">
          {shown.map((message) => {
            const attachments = message.attachments ?? [];
            return (
              <div
                key={message.id}
                className={`flex w-full ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg border px-3 py-2 ${
                    message.direction === "outbound"
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
                    <div className="text-sm font-medium">{message.subject}</div>
                  ) : null}
                  {message.body ? (
                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                      {message.body}
                    </div>
                  ) : null}
                  {attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {attachments.map((file) => (
                        <AttachmentChip
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
