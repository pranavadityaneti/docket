"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCase,
  getChecklist,
  uploadDocument,
  reviewDocument,
  removeDocument,
  requestDocuments,
  pauseNudges,
  resumeNudges,
  getCaseMessages,
  getCaseEvents,
  getCaseConversation,
  addCaseComment,
  confirmSuggestion,
  dismissSuggestion,
  reclassifyDocument,
  AuthRequiredError,
  type ApiCaseDetail,
  type ApiChecklist,
  type ApiChecklistItem,
  type ApiDocument,
  type ApiCaseMessage,
  type ApiCaseEvent,
  type ApiConversationEntry,
  type NudgeResult,
  type ChecklistItemStatus,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Case detail — the screen the product exists for: what this subject
 * still owes us, what has arrived, and what a human needs to decide.
 *
 * Every judgement is the API's. Which requirements apply (conditions),
 * what state an item is in (roll-up), and whether a file really landed
 * (storage read-back) are all answered server-side, because the
 * WhatsApp bot and the voice bot will ask the same questions and must
 * get the same answers. This screen renders; it does not decide.
 * ------------------------------------------------------------------ */

const STATUS_META: Record<
  ChecklistItemStatus,
  { label: string; tone: string; icon: string }
> = {
  missing: {
    label: "Not received",
    tone: "border-border bg-muted text-muted-foreground",
    icon: "radio_button_unchecked",
  },
  received: {
    label: "Received",
    tone: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
    icon: "inbox",
  },
  needs_review: {
    label: "Needs review",
    tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
    icon: "pending_actions",
  },
  accepted: {
    label: "Accepted",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    icon: "check_circle",
  },
  rejected: {
    label: "Rejected",
    tone: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
    icon: "cancel",
  },
  expired: {
    label: "Expired",
    tone: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300",
    icon: "schedule",
  },
};

/** Where a file came from. Uploads are staff; the rest is the subject. */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  upload: "Uploaded here",
  import: "Imported",
  api: "API",
};
const MESSAGE_KIND_LABEL: Record<string, string> = {
  initial: "Initial request",
  reminder: "Reminder",
  manual: "Manual request",
};

function fileSize(bytes: number | null) {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Shown for a row whose bytes never landed — it is not "Received". */
const INCOMPLETE_META = {
  label: "Incomplete",
  tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  icon: "error_outline",
};

function StatusBadge({
  status,
  landed = true,
}: {
  status: ChecklistItemStatus;
  /** False for an abandoned upload: a reservation carries status "received"
      even though nothing arrived, and showing that word is the lie. */
  landed?: boolean;
}) {
  const m = landed ? STATUS_META[status] : INCOMPLETE_META;
  return (
    <Badge variant="outline" className={`${m.tone} gap-1 whitespace-nowrap font-normal`}>
      <Icon name={m.icon} size={13} />
      {m.label}
    </Badge>
  );
}

/* ------------------------------- progress ------------------------------- */

function ProgressCard({
  summary,
  subjectLabel,
}: {
  summary: ApiChecklist["summary"];
  subjectLabel: string;
}) {
  const pct = summary.required === 0 ? 100 : Math.round((summary.accepted / summary.required) * 100);
  const done = summary.required > 0 && summary.accepted === summary.required;

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium">Collection progress</div>
        <div className="text-sm tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{summary.accepted}</span> of{" "}
          {summary.required} required accepted
        </div>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Required documents accepted"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${done ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground tabular-nums">{summary.outstanding}</span>{" "}
          still to chase
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">{summary.awaitingReview}</span>{" "}
          waiting on you
        </span>
        {done ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            Everything required is in — nothing to ask the {subjectLabel.toLowerCase()} for.
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------- documents ------------------------------- */

function DocumentRow({
  doc,
  onReview,
  onRemove,
  busy,
}: {
  doc: ApiDocument;
  onReview: (doc: ApiDocument, status: "accepted" | "rejected") => void;
  onRemove: (doc: ApiDocument) => void;
  busy: boolean;
}) {
  const size = fileSize(doc.sizeBytes);
  const channel = doc.sourceChannel ? CHANNEL_LABEL[doc.sourceChannel] ?? doc.sourceChannel : null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2">
      <Icon name="description" size={16} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{doc.fileName}</div>
        <div className="text-xs text-muted-foreground">
          {[channel, size, when(doc.receivedAt)].filter(Boolean).join(" · ")}
          {/* A reserved row whose bytes never landed. Shown rather than hidden:
              a file the borrower believes they sent is exactly what generates a
              support call. */}
          {!doc.uploaded ? (
            <span className="ml-1 text-amber-600 dark:text-amber-400">· upload incomplete</span>
          ) : null}
          {/* A machine put this here. Say so plainly — staff reviewing a
              document deserve to know a classifier chose the slot, not a
              colleague, and what it thought the document was. */}
          {doc.autoFiled ? (
            <span className="ml-1 text-violet-600 dark:text-violet-400">
              · filed by AI{doc.classifiedType ? ` as ${doc.classifiedType}` : ""}
            </span>
          ) : null}
        </div>
        {doc.status === "rejected" && doc.rejectionReason ? (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">
            Rejected: {doc.rejectionReason}
          </div>
        ) : null}
      </div>

      <StatusBadge status={doc.status} landed={doc.uploaded} />

      {/* Review is offered only where it means something: an accepted or
          rejected file is already decided, and a row with no bytes has nothing
          to look at. */}
      <div className="flex gap-1">
        {doc.uploaded && (doc.status === "received" || doc.status === "needs_review") ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busy}
              onClick={() => onReview(doc, "accepted")}
            >
              <Icon name="check" size={14} /> Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busy}
              onClick={() => onReview(doc, "rejected")}
            >
              <Icon name="close" size={14} /> Reject
            </Button>
          </>
        ) : null}
        {/* Offered at every status, accepted included: the reason to remove a
            document is usually that it should never have been filed — the wrong
            file, or someone else's — and that does not stop being true once
            somebody has approved it. */}
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0 text-muted-foreground hover:text-red-600"
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

/**
 * A refused action must explain itself WHERE THE CLICK HAPPENED. The old
 * single page-top banner meant that on a long checklist the server's perfectly
 * good explanation ("already has 1 file") rendered off-screen and the button
 * read as dead. `id` is the document (or requirement, for uploads) the error
 * belongs to; null = a page-level failure, which still uses the top banner.
 */
type ActionError = { id: string | null; message: string };

function InlineActionError({ error, forId }: { error: ActionError | null; forId: string }) {
  if (!error || error.id !== forId) return null;
  return (
    <div className="w-full rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {error.message}
    </div>
  );
}

function ChecklistRow({
  item,
  onUpload,
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
  onReview: (doc: ApiDocument, status: "accepted" | "rejected") => void;
  onRemove: (doc: ApiDocument) => void;
  busyId: string | null;
  uploading: string | null;
  actionError: ActionError | null;
  /** Comments pinned to THIS item — special instructions for the team. */
  notes: ApiCaseEvent[];
  onAddNote: (requirementId: string, body: string) => Promise<void>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const isUploading = uploading === item.requirementId;
  // The API decides this — see ApiChecklistItem.canUpload. Counting
  // item.documents here would grey out the button on a rejected item that the
  // server would happily accept a replacement for.
  const full = !item.canUpload;

  return (
    <div className="border-b p-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
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

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 gap-1 px-2 text-xs ${notes.length > 0 ? "text-foreground" : "text-muted-foreground"}`}
            onClick={() => setNotesOpen((o) => !o)}
            title="Notes for teammates about this item"
          >
            <Icon name="sticky_note_2" size={15} />
            {notes.length > 0 ? `Notes (${notes.length})` : "Notes"}
          </Button>
          <StatusBadge status={item.status} />
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared before the async work so picking the SAME file again
              // still fires onChange — otherwise a retry after a failed upload
              // silently does nothing.
              e.target.value = "";
              if (file) onUpload(item, file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
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

      {/* Special instructions live ON the item they are about — "certified
          copy only", "waiting on the CA" — where the teammate handling the
          document will actually see them. */}
      {notesOpen ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {notes.map((n) => (
            <NoteLine key={n.id} note={n} />
          ))}
          <NoteComposer
            placeholder={`Add a note about ${item.label}…`}
            onSubmit={(body) => onAddNote(item.requirementId, body)}
          />
        </div>
      ) : null}

      {/* An upload refused for this item (e.g. slot already full) explains
          itself right here, under the Upload button it belongs to. */}
      {actionError?.id === item.requirementId ? (
        <div className="mt-2">
          <InlineActionError error={actionError} forId={item.requirementId} />
        </div>
      ) : null}

      {item.documents.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {item.documents.map((d) => (
            <React.Fragment key={d.id}>
              <DocumentRow doc={d} onReview={onReview} onRemove={onRemove} busy={busyId === d.id} />
              <InlineActionError error={actionError} forId={d.id} />
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- reject dialog ------------------------------- */

function RejectDialog({
  doc,
  onCancel,
  onConfirm,
}: {
  doc: ApiDocument | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  // Reset whenever a different document is put up for rejection, so last
  // time's reason can never be attached to this file.
  const [forDoc, setForDoc] = React.useState<string | null>(null);
  if (doc && doc.id !== forDoc) {
    setForDoc(doc.id);
    setReason("");
    setTouched(false);
  }

  const invalid = !reason.trim();

  return (
    <Dialog open={!!doc} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this document</DialogTitle>
          <DialogDescription>
            The reason is shown to your team and is what the follow-up message will
            quote — write it as you would say it to the sender.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4">
          <div className="mb-2 truncate text-sm text-muted-foreground">{doc?.fileName}</div>
          <Input
            value={reason}
            autoFocus
            maxLength={500}
            placeholder="e.g. Page 2 is cut off — please resend the full statement"
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !invalid) onConfirm(reason.trim());
            }}
          />
          {touched && invalid ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              A reason is required — the API rejects a rejection without one.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={invalid} onClick={() => onConfirm(reason.trim())}>
            Reject document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- remove dialog ------------------------------- */

function RemoveDialog({
  doc,
  onCancel,
  onConfirm,
}: {
  doc: ApiDocument | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [forDoc, setForDoc] = React.useState<string | null>(null);
  // Reset when a different document is put up for removal, so last time's
  // reason can never be attached to this file.
  if (doc && doc.id !== forDoc) {
    setForDoc(doc.id);
    setReason("");
  }

  return (
    <Dialog open={!!doc} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this document?</DialogTitle>
          <DialogDescription>
            The file is deleted permanently — this cannot be undone. A record of the
            removal is kept, showing the file name and who removed it.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4">
          <div className="mb-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <Icon name="description" size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm">{doc?.fileName}</span>
            {doc ? <StatusBadge status={doc.status} /> : null}
          </div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Reason (optional)
          </label>
          <Input
            value={reason}
            autoFocus
            maxLength={500}
            placeholder="e.g. Wrong file — belongs to another applicant"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm(reason.trim());
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={() => onConfirm(reason.trim())}
          >
            Remove permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- page ------------------------------- */

/** "just now" / "40s ago" / "3m ago" — how stale what you are looking at is. */
function agoLabel(loadedAt: number | null): string {
  if (loadedAt === null) return "";
  const secs = Math.max(0, Math.round((Date.now() - loadedAt) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return `${mins}m ago`;
}

/**
 * Refresh, with the age of what is on screen next to it.
 *
 * The page fetches on mount and never again, and documents arrive through a
 * pipeline with real latency (mailbox polled once a minute, then each file is
 * read by the classifier). Without this, a stale screen and a broken one look
 * identical.
 */
function RefreshControl({
  loadedAt,
  refreshing,
  onRefresh,
}: {
  loadedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {refreshing ? "Checking…" : loadedAt ? `Updated ${agoLabel(loadedAt)}` : ""}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <Icon name="refresh" size={15} className={refreshing ? "animate-spin" : undefined} />
        Refresh
      </Button>
    </div>
  );
}

/* ------------------------------- notes ------------------------------- */

/** One-line note input. Clears itself on success; the caller refreshes. */
function NoteComposer({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setText("");
    } catch {
      // The caller has already surfaced the error (inline or banner); the
      // text stays in the box so nothing typed is lost.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0"
        disabled={busy || !text.trim()}
        onClick={() => void submit()}
      >
        {busy ? "Posting…" : "Add note"}
      </Button>
    </div>
  );
}

function NoteLine({ note }: { note: ApiCaseEvent }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <div className="whitespace-pre-wrap break-words">{note.body}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {note.authorName ?? "Unknown"} · {whenExact(note.createdAt)}
      </div>
    </div>
  );
}

/* ------------------------------- tabs ------------------------------- */

type CaseTab = "overview" | "checklist" | "conversations" | "activity" | "calls";

const TABS: { key: CaseTab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "person" },
  { key: "checklist", label: "Checklist", icon: "checklist" },
  { key: "conversations", label: "Conversations", icon: "forum" },
  { key: "activity", label: "Activity", icon: "timeline" },
  { key: "calls", label: "Calls", icon: "call" },
];

function TabBar({ tab, onChange }: { tab: CaseTab; onChange: (t: CaseTab) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
            tab === t.key
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
          {t.key === "calls" ? (
            <span className="rounded-full border bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              soon
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** "loan_amount" -> "Loan amount". Field configs will label these properly later. */
function humanise(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Indian-grouped numbers; money-ish keys get a rupee sign. */
function formatValue(key: string, value: unknown): string {
  if (typeof value === "number") {
    const grouped = value.toLocaleString("en-IN");
    return /amount|turnover|income|revenue/i.test(key) ? `₹${grouped}` : grouped;
  }
  return String(value);
}

function OverviewTab({ detail, subject }: { detail: ApiCaseDetail; subject: string }) {
  // data.source duplicates the case's own source column (both written by
  // intake); the case column is the authority, so the data copy is skipped.
  const fields = Object.entries(detail.data ?? {}).filter(([k]) => k !== "source");
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b p-4 font-medium">{subject}</div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="mt-0.5">{detail.subjectName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Organisation</dt>
            <dd className="mt-0.5">{detail.subjectOrganisation ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="mt-0.5 break-all">{detail.subjectEmail ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="mt-0.5">{detail.subjectPhone ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b p-4 font-medium">{detail.caseLabel}</div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="mt-0.5 font-mono text-[13px]">{detail.reference}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Workflow</dt>
            <dd className="mt-0.5">{detail.workflowName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Stage</dt>
            <dd className="mt-0.5">{detail.stageName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="mt-0.5">{detail.source ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="mt-0.5">{when(detail.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reminders</dt>
            <dd className="mt-0.5">{detail.nudgesPausedAt ? "Paused" : "Active"}</dd>
          </div>
        </dl>
      </Card>

      {fields.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b p-4 font-medium">Details</div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{humanise(k)}</dt>
                <dd className="mt-0.5 break-words">{formatValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------- activity ------------------------------- */

type ActivityEvent = {
  at: string;
  icon: string;
  title: string;
  detail?: string;
  failed?: boolean;
};

function whenExact(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * The case's journey, derived on the client from data the page already
 * fetches — nothing here is a second source of truth. Classification has no
 * timestamp in the payload, so what the AI read rides along on the arrival
 * event instead of pretending to know when it happened. A written event log
 * (stage moves, reviews, comments) is the planned upgrade; this renders
 * everything derivable today.
 */
function buildActivity(
  detail: ApiCaseDetail,
  checklist: ApiChecklist,
  messages: ApiCaseMessage[],
  journal: ApiCaseEvent[],
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  // The written journal: notes and recorded events, each with a real author
  // and a real timestamp — no derivation needed.
  const itemLabel = new Map(checklist.items.map((i) => [i.requirementId, i.label]));
  for (const ev of journal) {
    if (ev.kind === "comment") {
      const pin = ev.requirementId ? itemLabel.get(ev.requirementId) : null;
      events.push({
        at: ev.createdAt,
        icon: "sticky_note_2",
        title: `Note by ${ev.authorName ?? "Unknown"}${pin ? ` on “${pin}”` : ""}`,
        detail: ev.body ?? undefined,
      });
    } else if (ev.kind === "stage_changed") {
      const d = ev.data as { from?: string | null; to?: string };
      events.push({
        at: ev.createdAt,
        icon: "arrow_forward",
        title: `Stage: ${d.from ?? "—"} → ${d.to ?? "?"}`,
        detail: `by ${ev.authorName ?? "Unknown"}`,
      });
    } else if (ev.kind === "document_reviewed") {
      const d = ev.data as { fileName?: string; status?: string; reason?: string | null };
      events.push({
        at: ev.createdAt,
        icon:
          d.status === "accepted"
            ? "check_circle"
            : d.status === "rejected"
              ? "cancel"
              : "pending_actions",
        title: `${d.fileName ?? "Document"} ${d.status ?? "reviewed"}`,
        detail: `by ${ev.authorName ?? "Unknown"}${d.reason ? ` — ${d.reason}` : ""}`,
        failed: d.status === "rejected",
      });
    }
  }

  events.push({
    at: detail.createdAt,
    icon: "flag",
    title: `${detail.caseLabel} created`,
    detail: detail.source ? `via ${detail.source}` : undefined,
  });

  for (const item of checklist.items) {
    for (const d of item.documents) {
      if (!d.uploaded) continue; // reservations whose bytes never landed
      const bits: string[] = [];
      if (d.sourceChannel) bits.push(`via ${CHANNEL_LABEL[d.sourceChannel] ?? d.sourceChannel}`);
      if (d.classifiedType) {
        bits.push(
          `AI read it as “${d.classifiedType}”${d.classificationConfidence ? ` (${d.classificationConfidence})` : ""}`,
        );
      }
      bits.push(d.autoFiled ? `filed automatically under “${item.label}”` : `on “${item.label}”`);
      events.push({
        at: d.receivedAt,
        icon: d.autoFiled ? "auto_awesome" : "description",
        title: `${d.fileName} received`,
        detail: bits.join(" · "),
      });
    }
  }
  for (const d of checklist.unclassified) {
    if (!d.uploaded) continue;
    const bits: string[] = [];
    if (d.sourceChannel) bits.push(`via ${CHANNEL_LABEL[d.sourceChannel] ?? d.sourceChannel}`);
    if (d.classifiedType) bits.push(`AI read it as “${d.classifiedType}” — awaiting a human`);
    else bits.push("not yet matched to a checklist item");
    events.push({ at: d.receivedAt, icon: "help", title: `${d.fileName} received`, detail: bits.join(" · ") });
  }

  for (const m of messages) {
    events.push({
      at: m.sentAt,
      icon: m.channel === "whatsapp" ? "chat" : "mail",
      title: `${MESSAGE_KIND_LABEL[m.kind] ?? m.kind} ${m.status === "failed" ? "failed" : "sent"} · ${CHANNEL_LABEL[m.channel] ?? m.channel}`,
      detail: `${m.recipient}${m.status === "failed" && m.error ? ` — ${m.error}` : ""}`,
      failed: m.status === "failed",
    });
  }

  if (detail.nudgesPausedAt) {
    events.push({ at: detail.nudgesPausedAt, icon: "pause", title: "Reminders paused" });
  }

  // Newest first — the question at the top of a timeline is "what just happened?"
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function ActivityTab({ events }: { events: ActivityEvent[] }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b p-4">
        <div className="font-medium">Activity</div>
        <p className="text-sm text-muted-foreground">
          Every touchpoint on this case, newest first.
        </p>
      </div>
      <div className="flex flex-col p-4">
        {events.map((e, i) => (
          <div key={`${e.at}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
            {/* the spine */}
            {i < events.length - 1 ? (
              <div className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-border" />
            ) : null}
            <div
              className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                e.failed
                  ? "border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon name={e.icon} size={14} />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-sm">{e.title}</div>
              {e.detail ? <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div> : null}
              <div className="mt-0.5 text-xs text-muted-foreground/70">{whenExact(e.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------- conversations ------------------------------- */

/**
 * The back-and-forth as a thread: the subject's words on the left, ours on
 * the right — the shape everyone already reads chats in. Documents aren't
 * repeated here (the checklist owns them); what this adds is the WORDS,
 * which until now were thrown away on arrival.
 */
function ConversationsTab({
  entries,
  subject,
}: {
  entries: ApiConversationEntry[];
  subject: string;
}) {
  const [channel, setChannel] = React.useState<"all" | "email" | "whatsapp">("all");
  const shown = entries.filter((e) => channel === "all" || e.channel === channel);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <div className="font-medium">Conversations</div>
          <p className="text-sm text-muted-foreground">
            Every message exchanged with this {subject.toLowerCase()}.
          </p>
        </div>
        <div className="flex gap-1">
          {(["all", "email", "whatsapp"] as const).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={channel === c ? "default" : "outline"}
              className="h-7 px-2.5 text-xs capitalize"
              onClick={() => setChannel(c)}
            >
              {c === "all" ? "All" : CHANNEL_LABEL[c]}
            </Button>
          ))}
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
          {shown.map((m) => (
            <div
              key={m.id}
              className={`flex w-full ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-lg border px-3 py-2 ${
                  m.direction === "outbound"
                    ? "rounded-br-sm bg-primary/10 dark:bg-primary/20"
                    : "rounded-bl-sm bg-muted/60"
                }`}
              >
                <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon name={m.channel === "whatsapp" ? "chat" : "mail"} size={12} />
                  {m.direction === "outbound" ? "To" : "From"} {m.counterpart}
                  {m.kind ? ` · ${MESSAGE_KIND_LABEL[m.kind] ?? m.kind}` : ""}
                  {m.failed ? <span className="font-medium text-red-600 dark:text-red-400">· failed</span> : null}
                </div>
                {m.subject ? <div className="text-sm font-medium">{m.subject}</div> : null}
                {m.body ? (
                  <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                    {m.body}
                  </div>
                ) : null}
                <div className="mt-1 text-right text-[11px] text-muted-foreground/70">
                  {whenExact(m.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CallsPlaceholder({ subject }: { subject: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon name="call" size={22} className="text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">Calls are coming soon</div>
      <p className="max-w-sm px-4 text-sm text-muted-foreground">
        Calls with the {subject.toLowerCase()} will appear here — outcomes, notes and recordings,
        alongside every other touchpoint on the case.
      </p>
    </Card>
  );
}

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = params.id;

  const [detail, setDetail] = React.useState<ApiCaseDetail | null>(null);
  const [checklist, setChecklist] = React.useState<ApiChecklist | null>(null);
  const [loading, setLoading] = React.useState(true);
  /**
   * When the on-screen data was last fetched, and whether a fetch is running.
   *
   * Documents arrive through a pipeline the user cannot see — the mailbox is
   * polled once a minute and each new file is then read by the classifier —
   * so a case that looks empty may simply be a page loaded 90 seconds ago.
   * Showing the age of what is on screen turns "is it broken?" into "it is
   * 40 seconds old", which is the question people are actually asking.
   */
  const [loadedAt, setLoadedAt] = React.useState<number | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ActionError | null>(null);
  // Checklist first: the product exists for "what is still missing?", so the
  // landing view stays what it has always been. The other tabs are additive.
  const [tab, setTab] = React.useState<CaseTab>("checklist");
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ApiDocument | null>(null);
  const [removing, setRemoving] = React.useState<ApiDocument | null>(null);
  const [hasData, setHasData] = React.useState(false);
  const [messages, setMessages] = React.useState<ApiCaseMessage[]>([]);
  const [events, setEvents] = React.useState<ApiCaseEvent[]>([]);
  const [conversation, setConversation] = React.useState<ApiConversationEntry[]>([]);
  const [nudging, setNudging] = React.useState(false);
  const [pausing, setPausing] = React.useState(false);
  const [nudgeNotice, setNudgeNotice] = React.useState<string | null>(null);

  // `hasData` distinguishes "never loaded" from "reload failed". A failure with
  // data already on screen must NOT blank the checklist — it becomes a banner,
  // because throwing away a working screen over one transient blip is worse
  // than showing slightly stale data next to the error.
  const refresh = React.useCallback(async (opts?: { background?: boolean }) => {
    const background = opts?.background === true;
    try {
      const [c, cl, msgs, evs, conv] = await Promise.all([
        getCase(caseId),
        getChecklist(caseId),
        getCaseMessages(caseId),
        getCaseEvents(caseId),
        getCaseConversation(caseId),
      ]);
      setDetail(c);
      setChecklist(cl);
      setMessages(msgs);
      setEvents(evs);
      setConversation(conv);
      setLoadedAt(Date.now());
      setError(null);
      // A background poll must NOT clear a message the user has not read.
      // "Residence address proof already has 1 file" disappearing 15 seconds
      // after it appears is worse than never showing it.
      if (!background) setActionError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      // A background poll that fails stays quiet: the screen keeps working on
      // the data it has, the age label stops advancing, and the next tick
      // usually recovers. Shouting about a transient blip nobody asked for
      // trains people to ignore the banner.
      if (background) return;
      const msg = e instanceof Error ? e.message : "Couldn't load this case.";
      setHasData((had) => {
        if (had) setActionError({ id: null, message: msg });
        else setError(msg);
        return had;
      });
      return;
    } finally {
      setLoading(false);
    }
    setHasData(true);
  }, [caseId]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  /** Manual refresh: same fetch, plus the in-flight state the buttons show. */
  const manualRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Re-render once a second ONLY while a case is open, so the "updated Ns ago"
  // label counts up instead of freezing at whatever it said on load. Cheap:
  // one setState of a number, no fetching.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * Anything the user has in flight. Read by the auto-refresh below through a
   * ref, so the poll does not land mid-action — replacing the checklist while
   * a document is being filed makes rows jump under the cursor, and the
   * refresh that every action already does on completion is the correct one.
   */
  const actionInFlight =
    busyId !== null || uploading !== null || refreshing || nudging || pausing;
  const busyRef = React.useRef(false);
  // Mirrored in an effect, not during render: writing a ref while rendering is
  // the anti-pattern React warns about, and the interval only ever reads it
  // after a commit anyway.
  React.useEffect(() => {
    busyRef.current = actionInFlight;
  }, [actionInFlight]);

  /**
   * Auto-refresh while a case is open.
   *
   * Documents arrive on their own schedule — the mailbox is polled once a
   * minute, then the classifier reads each file — so the case a person is
   * watching changes without them doing anything. 15s is well inside that
   * pipeline's own latency, so files appear on screen shortly after they are
   * real, and it is quiet enough to be unnoticeable.
   *
   * Three guards: skip while the tab is hidden (a backgrounded tab polling
   * forever is pure waste), skip while an action is in flight, and skip while
   * a fetch is already running. Failures stay silent — see refresh().
   */
  React.useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (busyRef.current) return;
      void refresh({ background: true });
    }, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleUpload(item: ApiChecklistItem, file: File) {
    setActionError(null);
    setUploading(item.requirementId);
    try {
      await uploadDocument(caseId, file, item.requirementId);
      // Refetch rather than patch local state: the server decides status and
      // reads the real size back from storage, so anything assembled here
      // would be a guess that can disagree with it.
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: item.requirementId, message: e instanceof Error ? e.message : "Upload failed. Please try again." });
    } finally {
      setUploading(null);
    }
  }

  async function handleReview(doc: ApiDocument, status: "accepted" | "rejected") {
    // Rejection needs a reason, so it goes through the dialog instead.
    if (status === "rejected") {
      setRejecting(doc);
      return;
    }
    setActionError(null);
    setBusyId(doc.id);
    try {
      await reviewDocument(doc.id, "accepted");
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: doc.id, message: e instanceof Error ? e.message : "Couldn't accept the document." });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject(reason: string) {
    const doc = rejecting;
    if (!doc) return;
    setRejecting(null);
    setActionError(null);
    setBusyId(doc.id);
    try {
      await reviewDocument(doc.id, "rejected", reason);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: doc.id, message: e instanceof Error ? e.message : "Couldn't reject the document." });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove(reason: string) {
    const doc = removing;
    if (!doc) return;
    setRemoving(null);
    setActionError(null);
    setBusyId(doc.id);
    try {
      await removeDocument(doc.id, reason || undefined);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: doc.id, message: e instanceof Error ? e.message : "Couldn't remove the document." });
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmSuggestion(documentId: string) {
    setActionError(null);
    setBusyId(documentId);
    try {
      await confirmSuggestion(documentId);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      // The server's message is the useful one here: "already has N files",
      // "item no longer exists". Showing it beats a generic apology.
      setActionError({ id: documentId, message: e instanceof Error ? e.message : "Couldn't file the document." });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismissSuggestion(documentId: string) {
    setActionError(null);
    setBusyId(documentId);
    try {
      await dismissSuggestion(documentId);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: documentId, message: e instanceof Error ? e.message : "Couldn't dismiss the suggestion." });
    } finally {
      setBusyId(null);
    }
  }

  // The await spans the model call itself (typically 5–15s) — the button
  // shows "Looking…" for the duration and the refresh lands the verdict.
  async function handleReclassify(documentId: string) {
    setActionError(null);
    setBusyId(documentId);
    try {
      await reclassifyDocument(documentId);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: documentId, message: e instanceof Error ? e.message : "Couldn't reclassify the document." });
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddNote(body: string, requirementId?: string) {
    setActionError(null);
    try {
      await addCaseComment(caseId, body, requirementId);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      // NoteComposer keeps the unsent text; the message lands on the item
      // (or the page banner for a case-level note).
      setActionError({
        id: requirementId ?? null,
        message: e instanceof Error ? e.message : "Couldn't add the note.",
      });
      throw e;
    }
  }

  // Turn a NudgeResult into one plain-English line for the staff notice.
  function describeNudge(r: NudgeResult): string {
    if (r.sent.length === 0) {
      const reason =
        r.skipped === "complete"
          ? "Nothing outstanding — no request sent."
          : r.skipped === "no-channel" || r.skipped === "no-contact"
            ? "No email or WhatsApp on file for this subject."
            : r.skipped === "paused"
              ? "Requests are paused for this case."
              : "Nothing was sent.";
      return reason;
    }
    return r.sent
      .map((s) =>
        s.ok
          ? `Sent via ${s.channel === "email" ? "email" : "WhatsApp"}.`
          : `${s.channel === "email" ? "Email" : "WhatsApp"} failed: ${s.detail ?? "unknown error"}`,
      )
      .join(" ");
  }

  async function handleRequestDocuments() {
    setActionError(null);
    setNudgeNotice(null);
    setNudging(true);
    try {
      const result = await requestDocuments(caseId);
      setNudgeNotice(describeNudge(result));
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: null, message: e instanceof Error ? e.message : "Couldn't send the request." });
    } finally {
      setNudging(false);
    }
  }

  async function handleTogglePause(paused: boolean) {
    setActionError(null);
    setNudgeNotice(null);
    setPausing(true);
    try {
      await (paused ? resumeNudges(caseId) : pauseNudges(caseId));
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({ id: null, message: e instanceof Error ? e.message : "Couldn't update reminders." });
    } finally {
      setPausing(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !detail || !checklist) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
          <Icon name="error" size={26} className="text-muted-foreground" />
          <div>
            <div className="font-medium">Couldn&rsquo;t open this case</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {error ?? "It may have been removed, or the link may be wrong."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/cases")}>
              Back to cases
            </Button>
            <Button onClick={() => void manualRefresh()}>Try again</Button>
          </div>
        </Card>
      </div>
    );
  }

  // Every label on this screen comes from the workflow this case belongs to —
  // "Borrower" for a lender, "Student" for a college, "Client" for a CA firm.
  const subject = detail.subjectLabel;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <Link
          href="/cases"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="arrow_back" size={16} /> All cases
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          {/* flex-1 is load-bearing, not decoration: `truncate` needs a
              constrained width, and min-w-0 alone leaves this box sized to its
              content — so a long subject or organisation name pushed straight
              through the header instead of ellipsing. title= keeps the full
              value reachable on hover once it is clipped. */}
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-2xl font-semibold tracking-tight"
              title={detail.subjectName ?? undefined}
            >
              {detail.subjectName ?? "Unnamed"}
            </h1>
            {(() => {
              const subtitle = [
                detail.subjectOrganisation,
                detail.reference,
                `${detail.workflowName} ${detail.caseLabel.toLowerCase()}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <p className="mt-0.5 truncate text-sm text-muted-foreground" title={subtitle}>
                  {subtitle}
                </p>
              );
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {detail.stageName ? (
              <Badge variant="outline" className="whitespace-nowrap">
                {detail.stageName}
              </Badge>
            ) : null}
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleRequestDocuments}
              disabled={nudging}
            >
              <Icon name="send" size={16} /> {nudging ? "Sending…" : "Request documents"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => handleTogglePause(detail.nudgesPausedAt !== null)}
              disabled={pausing}
            >
              <Icon name={detail.nudgesPausedAt ? "play_arrow" : "pause"} size={16} />
              {detail.nudgesPausedAt ? "Resume reminders" : "Pause reminders"}
            </Button>
            <RefreshControl
              loadedAt={loadedAt}
              refreshing={refreshing}
              onRefresh={manualRefresh}
            />
          </div>
        </div>

        {detail.subjectEmail || detail.subjectPhone ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {detail.subjectPhone ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="call" size={14} /> {detail.subjectPhone}
              </span>
            ) : null}
            {detail.subjectEmail ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="mail" size={14} /> {detail.subjectEmail}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {actionError && actionError.id === null ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {actionError.message}
        </div>
      ) : null}

      {nudgeNotice ? (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {nudgeNotice}
        </div>
      ) : null}

      <TabBar tab={tab} onChange={setTab} />

      {tab === "overview" ? <OverviewTab detail={detail} subject={subject} /> : null}

      {tab === "activity" ? (
        <>
          <Card className="p-3">
            <NoteComposer
              placeholder="Add a note to this case…"
              onSubmit={(body) => handleAddNote(body)}
            />
          </Card>
          <ActivityTab events={buildActivity(detail, checklist, messages, events)} />
        </>
      ) : null}

      {tab === "conversations" ? (
        <ConversationsTab entries={conversation} subject={subject} />
      ) : null}

      {tab === "calls" ? <CallsPlaceholder subject={subject} /> : null}

      {tab === "checklist" ? (
        <>
      <ProgressCard summary={checklist.summary} subjectLabel={subject} />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div>
            <div className="font-medium">Document checklist</div>
            <p className="text-sm text-muted-foreground">
              What this {subject.toLowerCase()} has been asked for, and what has arrived.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm tabular-nums text-muted-foreground">
              {checklist.items.length} item{checklist.items.length === 1 ? "" : "s"}
            </span>
            {/* Right where documents appear, because this is the screen people
                sit on while waiting for a borrower's email to land. */}
            <RefreshControl
              loadedAt={loadedAt}
              refreshing={refreshing}
              onRefresh={manualRefresh}
            />
          </div>
        </div>

        {checklist.items.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-sm font-medium">No documents required</div>
            <p className="mt-1 text-sm text-muted-foreground">
              This workflow has no checklist configured yet.
            </p>
          </div>
        ) : (
          checklist.items.map((item) => (
            <ChecklistRow
              key={item.requirementId}
              item={item}
              onUpload={handleUpload}
              onReview={handleReview}
              onRemove={setRemoving}
              busyId={busyId}
              uploading={uploading}
              actionError={actionError}
              notes={events.filter(
                (ev) => ev.kind === "comment" && ev.requirementId === item.requirementId,
              )}
              onAddNote={(requirementId, body) => handleAddNote(body, requirementId)}
            />
          ))
        )}
      </Card>

      {/* Files that arrived matching no checklist item — someone sending
          something unexpected, or the classifier declining to guess. Never
          dropped; a human places them. */}
      {checklist.unclassified.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b p-4">
            <div className="font-medium">Unmatched files</div>
            <p className="text-sm text-muted-foreground">
              These arrived but aren&rsquo;t on a checklist item yet.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 p-4">
            {checklist.unclassified.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2"
              >
                <Icon
                  name={d.suggestedLabel ? "auto_awesome" : "help"}
                  size={16}
                  className={`shrink-0 ${d.suggestedLabel ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{d.fileName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      d.sourceChannel ? CHANNEL_LABEL[d.sourceChannel] ?? d.sourceChannel : null,
                      when(d.receivedAt),
                      // What the classifier read, even when it proposed nothing:
                      // "looks like a utility bill" is useful to a human placing
                      // it by hand.
                      d.classifiedType ? `looks like ${d.classifiedType}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>

                {/* A proposal the classifier was not confident enough to act on.
                    One click files it (through the same capacity check every
                    other placement runs); one click makes it stop asking. */}
                {d.suggestedLabel ? (
                  <>
                    <Badge
                      variant="outline"
                      className="whitespace-nowrap border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300"
                    >
                      {d.suggestedLabel}?
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busyId === d.id}
                      onClick={() => handleConfirmSuggestion(d.id)}
                    >
                      <Icon name="check" size={14} /> File it
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={busyId === d.id}
                      onClick={() => handleDismissSuggestion(d.id)}
                    >
                      Not this
                    </Button>
                  </>
                ) : (
                  <>
                    <StatusBadge status={d.status} landed={d.uploaded} />
                    {/* The manual second look. Only for files whose bytes have
                        actually landed — there is nothing to read otherwise —
                        and only when no suggestion is pending (a pending
                        proposal has its own two buttons; dismissing it brings
                        this one back). */}
                    {d.uploaded ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={busyId === d.id}
                        onClick={() => handleReclassify(d.id)}
                      >
                        <Icon name="auto_awesome" size={14} />
                        {busyId === d.id ? "Looking…" : "Reclassify"}
                      </Button>
                    ) : null}
                  </>
                )}
                <InlineActionError error={actionError} forId={d.id} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}
        </>
      ) : null}

      <RejectDialog
        doc={rejecting}
        onCancel={() => setRejecting(null)}
        onConfirm={confirmReject}
      />

      <RemoveDialog
        doc={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
