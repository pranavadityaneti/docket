"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ApiCaseEvent, ApiChecklistItem, ApiDocument } from "@/features/case-detail/api";
import { formatDateTime, formatFileSize } from "@/lib/format";
import * as React from "react";
import { type ActionError, type PreviewTarget } from "./meta";
import { NoteComposer, NoteList } from "./notes";
import { StatusBadge } from "./status-badge";

export function InlineActionError({
  error,
  forId,
}: {
  error: ActionError | null;
  forId: string;
}) {
  if (!error || error.id !== forId) return null;
  return (
    <div className="w-full border border-danger-border bg-danger-muted px-2.5 py-1.5 text-xs text-danger-muted-foreground">
      {error.message}
    </div>
  );
}

export function DocumentRow({
  doc,
  onPreview,
  onReview,
  onRemove,
  busy,
}: {
  doc: ApiDocument;
  onPreview: (doc: PreviewTarget) => void;
  onReview: (doc: ApiDocument, status: "accepted" | "rejected") => void;
  onRemove: (doc: ApiDocument) => void;
  busy: boolean;
}) {
  const size = formatFileSize(doc.sizeBytes);
  const when = doc.receivedAt ? formatDateTime(doc.receivedAt) : "";
  const meta = [size, when].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border bg-background px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Icon name="description" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{doc.fileName}</div>
          {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
          {doc.status === "rejected" && doc.rejectionReason ? (
            <div className="mt-1 text-xs text-danger">Rejected: {doc.rejectionReason}</div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
        <StatusBadge status={doc.status} landed={doc.uploaded} />
        {doc.uploaded ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1 px-2 text-xs"
            disabled={busy}
            onClick={() =>
              onPreview({
                id: doc.id,
                fileName: doc.fileName,
                mimeType: doc.mimeType,
              })
            }
          >
            <Icon name="visibility" size={14} /> Preview
          </Button>
        ) : null}
        {doc.uploaded && (doc.status === "received" || doc.status === "needs_review") ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 px-2 text-xs"
              disabled={busy}
              onClick={() => onReview(doc, "accepted")}
            >
              <Icon name="check" size={14} /> Accept
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1 px-2 text-xs"
              disabled={busy}
              onClick={() => onReview(doc, "rejected")}
            >
              <Icon name="close" size={14} /> Reject
            </Button>
          </>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={busy}
          aria-label={`Remove ${doc.fileName}`}
          title="Remove this document"
          onClick={() => onRemove(doc)}
        >
          <Icon name="delete" size={15} />
        </Button>
      </div>
    </div>
  );
}

export function ChecklistRow({
  item,
  onUpload,
  onPreview,
  onReview,
  onRemove,
  busyId,
  uploading,
  actionError,
  notes,
  onAddNote,
}: {
  item: ApiChecklistItem;
  onUpload: (item: ApiChecklistItem, file: File) => void;
  onPreview: (doc: PreviewTarget) => void;
  onReview: (doc: ApiDocument, status: "accepted" | "rejected") => void;
  onRemove: (doc: ApiDocument) => void;
  busyId: string | null;
  uploading: string | null;
  actionError: ActionError | null;
  notes: ApiCaseEvent[];
  onAddNote: (requirementId: string, body: string) => Promise<void>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Composer starts open when this item already has notes so a page refresh
  // still shows them. Previously notesOpen defaulted to false, which hid
  // persisted notes behind a closed toggle and looked like they were lost.
  const [composerOpen, setComposerOpen] = React.useState(notes.length > 0);
  const isUploading = uploading === item.requirementId;
  const full = !item.canUpload;
  const showNotes = notes.length > 0 || composerOpen;

  return (
    <div className="border-b p-4 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.label}</span>
            {item.required ? null : (
              <span className="text-xs text-muted-foreground">(optional)</span>
            )}
            {item.reusable ? (
              <span
                className="rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                title={
                  item.validityDays
                    ? `Can be reused from another case for ${item.validityDays} days`
                    : "Can be reused from another case"
                }
              >
                reusable
              </span>
            ) : null}
          </div>
          {item.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          <Button
            size="sm"
            variant="ghost"
            className={`gap-1 px-2 text-xs ${notes.length > 0 ? "text-foreground" : "text-muted-foreground"}`}
            onClick={() => setComposerOpen((open) => !open)}
            title="Notes for teammates about this item"
          >
            <Icon name="sticky_note_2" size={15} />
            {notes.length > 0 ? `Notes (${notes.length})` : "Notes"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(item, file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={isUploading || full}
            title={
              full
                ? `${item.label} already has ${item.slotsUsed} of ${item.maxFiles} file${item.maxFiles === 1 ? "" : "s"}`
                : undefined
            }
            onClick={() => inputRef.current?.click()}
          >
            <Icon name={isUploading ? "progress_activity" : "upload"} size={15} />
            {isUploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {/* Notes persist in case_events; always render saved ones even if the
          composer toggle is closed so refresh never looks like data loss. */}
      {showNotes ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <NoteList notes={notes} />
          {composerOpen ? (
            <NoteComposer
              placeholder={`Add a note about ${item.label}…`}
              onSubmit={(body) => onAddNote(item.requirementId, body)}
            />
          ) : null}
        </div>
      ) : null}

      {actionError?.id === item.requirementId ? (
        <div className="mt-2">
          <InlineActionError error={actionError} forId={item.requirementId} />
        </div>
      ) : null}

      {item.documents.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {item.documents.map((document) => (
            <React.Fragment key={document.id}>
              <DocumentRow
                doc={document}
                onPreview={onPreview}
                onReview={onReview}
                onRemove={onRemove}
                busy={busyId === document.id}
              />
              <InlineActionError error={actionError} forId={document.id} />
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
