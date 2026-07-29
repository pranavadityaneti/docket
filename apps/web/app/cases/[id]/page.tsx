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
  AuthRequiredError,
  type ApiCaseDetail,
  type ApiChecklist,
  type ApiChecklistItem,
  type ApiDocument,
  type ApiCaseMessage,
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

function ChecklistRow({
  item,
  onUpload,
  onReview,
  onRemove,
  busyId,
  uploading,
}: {
  item: ApiChecklistItem;
  onUpload: (item: ApiChecklistItem, file: File) => void;
  onReview: (doc: ApiDocument, status: "accepted" | "rejected") => void;
  onRemove: (doc: ApiDocument) => void;
  busyId: string | null;
  uploading: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
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

      {item.documents.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {item.documents.map((d) => (
            <DocumentRow
              key={d.id}
              doc={d}
              onReview={onReview}
              onRemove={onRemove}
              busy={busyId === d.id}
            />
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

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = params.id;

  const [detail, setDetail] = React.useState<ApiCaseDetail | null>(null);
  const [checklist, setChecklist] = React.useState<ApiChecklist | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ApiDocument | null>(null);
  const [removing, setRemoving] = React.useState<ApiDocument | null>(null);
  const [hasData, setHasData] = React.useState(false);
  const [messages, setMessages] = React.useState<ApiCaseMessage[]>([]);
  const [nudging, setNudging] = React.useState(false);
  const [pausing, setPausing] = React.useState(false);
  const [nudgeNotice, setNudgeNotice] = React.useState<string | null>(null);

  // `hasData` distinguishes "never loaded" from "reload failed". A failure with
  // data already on screen must NOT blank the checklist — it becomes a banner,
  // because throwing away a working screen over one transient blip is worse
  // than showing slightly stale data next to the error.
  const refresh = React.useCallback(async () => {
    try {
      const [c, cl, msgs] = await Promise.all([
        getCase(caseId),
        getChecklist(caseId),
        getCaseMessages(caseId),
      ]);
      setDetail(c);
      setChecklist(cl);
      setMessages(msgs);
      setError(null);
      setActionError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      const msg = e instanceof Error ? e.message : "Couldn't load this case.";
      setHasData((had) => {
        if (had) setActionError(msg);
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
      setActionError(e instanceof Error ? e.message : "Upload failed. Please try again.");
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
      setActionError(e instanceof Error ? e.message : "Couldn't accept the document.");
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
      setActionError(e instanceof Error ? e.message : "Couldn't reject the document.");
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
      setActionError(e instanceof Error ? e.message : "Couldn't remove the document.");
    } finally {
      setBusyId(null);
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
      setActionError(e instanceof Error ? e.message : "Couldn't send the request.");
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
      setActionError(e instanceof Error ? e.message : "Couldn't update reminders.");
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
            <Button onClick={refresh}>Try again</Button>
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
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {detail.subjectName ?? "Unnamed"}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[
                detail.subjectOrganisation,
                detail.reference,
                `${detail.workflowName} ${detail.caseLabel.toLowerCase()}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
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
            <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh}>
              <Icon name="refresh" size={16} /> Refresh
            </Button>
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

      <ProgressCard summary={checklist.summary} subjectLabel={subject} />

      {actionError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </div>
      ) : null}

      {nudgeNotice ? (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {nudgeNotice}
        </div>
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div>
            <div className="font-medium">Document checklist</div>
            <p className="text-sm text-muted-foreground">
              What this {subject.toLowerCase()} has been asked for, and what has arrived.
            </p>
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">
            {checklist.items.length} item{checklist.items.length === 1 ? "" : "s"}
          </span>
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
              These arrived but don&rsquo;t match anything on the checklist.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 p-4">
            {checklist.unclassified.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2"
              >
                <Icon name="help" size={16} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{d.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      d.sourceChannel ? CHANNEL_LABEL[d.sourceChannel] ?? d.sourceChannel : null,
                      when(d.receivedAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Outbound history — every document request and reminder sent, so staff
          can see the chase without leaving the case. */}
      {messages.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b p-4">
            <div className="font-medium">Requests sent</div>
            <p className="text-sm text-muted-foreground">
              Document requests and reminders sent to this {subject.toLowerCase()}.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2"
              >
                <Icon
                  name={m.channel === "whatsapp" ? "chat" : "mail"}
                  size={16}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {MESSAGE_KIND_LABEL[m.kind] ?? m.kind} · {CHANNEL_LABEL[m.channel] ?? m.channel}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[m.recipient, when(m.sentAt)].filter(Boolean).join(" · ")}
                    {m.status === "failed" && m.error ? ` — ${m.error}` : ""}
                  </div>
                </div>
                <Badge variant={m.status === "failed" ? "destructive" : "outline"}>
                  {m.status === "failed" ? "Failed" : "Sent"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
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
