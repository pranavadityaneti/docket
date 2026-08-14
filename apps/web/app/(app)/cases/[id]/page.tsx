"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiCaseDetail, ApiCaseEvent, ApiCaseMessage, ApiChecklist, ApiChecklistItem, ApiConversationEntry, ApiDocument, NudgeResult } from "@/features/case-detail/api";
import { addCaseComment, confirmSuggestion, dismissSuggestion, getCase, getCaseConversation, getCaseEvents, getCaseMessages, getChecklist, pauseNudges, reclassifyDocument, removeDocument, replyToConversation, requestDocuments, resumeNudges, reviewDocument, uploadDocument } from "@/features/case-detail/api";
import {
  ActivityTab,
  buildActivity,
  CallsPlaceholder,
  CHANNEL_LABEL,
  ChecklistRow,
  ConversationsTab,
  DocumentPreviewDialog,
  InlineActionError,
  NoteComposer,
  OverviewTab,
  parseCaseTab,
  ProgressCard,
  RefreshControl,
  RejectDialog,
  RemoveDialog,
  StatusBadge,
  TabBar,
  UpdatedAgo,
  type ActionError,
  type CaseTab,
  type PreviewTarget,
} from "@/features/case-detail/components";
import {
  countUnseenInbound,
  markConversationSeen,
} from "@/features/case-detail/components/conversation-seen";
import { markCaseNotificationsRead } from "@/features/notifications/api";
import type { ApiFieldDef } from "@/features/workflows/api";
import { listWorkflows } from "@/features/workflows/api";
import { formatDate } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import { toneClass } from "@/lib/tones";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

export default function CaseDetailPage() {
  // useSearchParams (?tab=conversations from the inbox) needs a Suspense boundary.
  return (
    <React.Suspense>
      <CaseDetailPageInner />
    </React.Suspense>
  );
}

function CaseDetailPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = params.id;
  // Deep-linkable: /conversations and follow-ups can land on a specific tab
  // without the case always dumping people on Checklist.
  const tab = parseCaseTab(searchParams.get("tab"));
  const setTab = React.useCallback(
    (next: CaseTab) => {
      const q = new URLSearchParams(searchParams.toString());
      if (next === "checklist") q.delete("tab");
      else q.set("tab", next);
      const qs = q.toString();
      router.replace(qs ? `/cases/${caseId}?${qs}` : `/cases/${caseId}`, { scroll: false });
    },
    [caseId, router, searchParams],
  );

  const [detail, setDetail] = React.useState<ApiCaseDetail | null>(null);
  const [checklist, setChecklist] = React.useState<ApiChecklist | null>(null);
  const [loading, setLoading] = React.useState(true);
  /**
   * When the on-screen data was last fetched, and whether a fetch is running.
   *
   * Documents arrive through a pipeline the user cannot see - the mailbox is
   * polled once a minute and each new file is then read by the classifier -
   * so a case that looks empty may simply be a page loaded 90 seconds ago.
   * Showing the age of what is on screen turns "is it broken?" into "it is
   * 40 seconds old", which is the question people are actually asking.
   */
  const [loadedAt, setLoadedAt] = React.useState<number | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<ActionError | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ApiDocument | null>(null);
  const [removing, setRemoving] = React.useState<ApiDocument | null>(null);
  const [previewing, setPreviewing] = React.useState<PreviewTarget | null>(null);
  const [, setHasData] = React.useState(false);
  const [messages, setMessages] = React.useState<ApiCaseMessage[]>([]);
  const [events, setEvents] = React.useState<ApiCaseEvent[]>([]);
  const [conversation, setConversation] = React.useState<ApiConversationEntry[]>([]);
  /**
   * This workflow's field definitions - labels, types, options, validation.
   * Fetched separately from the case because /cases/:id returns the values,
   * not the schema, and the Overview needs the schema to both label a value
   * properly ("Loan Amount (₹)", not "Loan amount") and edit it correctly.
   */
  const [fields, setFields] = React.useState<ApiFieldDef[]>([]);
  const [nudging, setNudging] = React.useState(false);
  const [pausing, setPausing] = React.useState(false);
  const [nudgeNotice, setNudgeNotice] = React.useState<string | null>(null);
  const refreshGen = React.useRef(0);
  const fetchInFlightRef = React.useRef(false);

  // `hasData` distinguishes "never loaded" from "reload failed". A failure with
  // data already on screen must NOT blank the checklist - it becomes a banner,
  // because throwing away a working screen over one transient blip is worse
  // than showing slightly stale data next to the error.
  const refresh = React.useCallback(async (opts?: { background?: boolean }) => {
    const background = opts?.background === true;
    // Stacked silent polls fight each other and can leave the UI on an older
    // snapshot; skip if one is already in flight. Manual / post-action refresh
    // always runs - it bumps the generation and wins.
    if (background && fetchInFlightRef.current) return;
    const gen = ++refreshGen.current;
    fetchInFlightRef.current = true;
    try {
      const [c, cl, msgs, evs, conv] = await Promise.all([
        getCase(caseId),
        getChecklist(caseId),
        getCaseMessages(caseId),
        getCaseEvents(caseId),
        getCaseConversation(caseId),
      ]);
      if (gen !== refreshGen.current) return;
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
      if (gen !== refreshGen.current) return;
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
      if (gen === refreshGen.current) {
        setLoading(false);
        fetchInFlightRef.current = false;
      }
    }
    if (gen !== refreshGen.current) return;
    setHasData(true);
  }, [caseId]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Field definitions change only when a workflow is reconfigured, so they are
  // loaded once rather than on every auto-refresh. A failure here is not fatal:
  // Overview still renders the values, just with humanised keys.
  React.useEffect(() => {
    let cancelled = false;
    void listWorkflows()
      .then((ws) => {
        if (cancelled) return;
        const mine = ws.find((w) => w.id === detail?.workflowId);
        if (mine) setFields(mine.fields ?? []);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [detail?.workflowId]);

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
   * ref, so the poll does not land mid-action - replacing the checklist while
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
   * Auto-refresh while a case is open - silent, no spinner / "Checking...".
   *
   * Documents arrive on their own schedule - the mailbox is polled once a
   * minute, then the classifier reads each file - so the case a person is
   * watching changes without them doing anything. 15s is well inside that
   * pipeline's own latency, so files appear on screen shortly after they are
   * real, and it is quiet enough to be unnoticeable.
   *
   * Guards: skip while the tab is hidden, skip while an action is in flight,
   * skip while a fetch is already running (inside refresh). Failures stay
   * silent - see refresh(). Also refetch when the tab becomes visible again.
   */
  React.useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (busyRef.current) return;
      void refresh({ background: true });
    };
    const id = setInterval(tick, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !busyRef.current) {
        void refresh({ background: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // While staff are on the Conversations tab, keep the "seen" cursor current so
  // the tab badge and related bell items clear as new inbound lines land.
  React.useEffect(() => {
    if (tab !== "conversations") return;
    markConversationSeen(caseId, conversation);
    void markCaseNotificationsRead(caseId).catch(() => {});
  }, [tab, caseId, conversation]);

  // First open of this case in this browser: baseline the seen cursor so the
  // Conversations badge only counts messages that arrive AFTER now, not history.
  React.useEffect(() => {
    if (countUnseenInbound(caseId, conversation) === 0) return;
    if (tab === "conversations") return;
    // Only baseline when there is no stored cursor yet (count equals all inbound).
    const inbound = conversation.filter((m) => m.direction === "inbound").length;
    if (inbound > 0 && countUnseenInbound(caseId, conversation) === inbound) {
      markConversationSeen(caseId, conversation);
    }
  }, [caseId, conversation, tab]);

  const conversationBadge = React.useMemo(
    () => (tab === "conversations" ? 0 : countUnseenInbound(caseId, conversation)),
    [tab, caseId, conversation],
  );

  async function handleUpload(item: ApiChecklistItem, file: File) {
    setActionError(null);
    setUploading(item.requirementId);
    try {
      await uploadDocument(caseId, file, item.requirementId);
      // Refetch rather than patch local state: the server decides status and
      // reads the real size back from storage, so anything assembled here
      // would be a guess that can disagree with it. Does not flip the Refresh
      // button - only manualRefresh sets that chrome.
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

  // The await spans the model call itself (typically 5–15s) - the button
  // shows "Looking..." for the duration and the refresh lands the verdict.
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

  async function handleConversationReply(
    body: string,
    channel: "email" | "whatsapp",
  ) {
    setActionError(null);
    try {
      await replyToConversation(caseId, body, channel);
      await refresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError({
        id: null,
        message: e instanceof Error ? e.message : "Couldn't send the message.",
      });
      throw e;
    }
  }

  // Turn a NudgeResult into one plain-English line for the staff notice.
  function describeNudge(r: NudgeResult): string {
    if (r.sent.length === 0) {
      const reason =
        r.skipped === "complete"
          ? "Nothing outstanding - no request sent."
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
      <div className="flex w-full flex-col gap-4">
        <Skeleton className="w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !detail || !checklist) {
    return (
      <div className="w-full">
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

  // Every label on this screen comes from the workflow this case belongs to -
  // "Borrower" for a lender, "Student" for a college, "Client" for a CA firm.
  const subject = detail.subjectLabel;

  return (
    <div className="flex w-full flex-col gap-4 sm:gap-5">
      <div>
        <Link
          href="/cases"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="arrow_back" size={16} /> All cases
        </Link>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {/* flex-1 is load-bearing, not decoration: `truncate` needs a
              constrained width, and min-w-0 alone leaves this box sized to its
              content - so a long subject or organisation name pushed straight
              through the header instead of ellipsing. title= keeps the full
              value reachable on hover once it is clipped. */}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {detail.caseLabel}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1
                className="min-w-0 truncate text-xl font-semibold tracking-tight text-balance sm:text-2xl"
                title={detail.subjectName ?? undefined}
              >
                {detail.subjectName ?? "Unnamed"}
              </h1>
              {detail.stageName ? (
                <Badge
                  variant="outline"
                  className={`${toneClass(detail.stageTone)} h-6 shrink-0 rounded-full px-2.5 font-medium`}
                >
                  {detail.stageName}
                </Badge>
              ) : null}
              <UpdatedAgo loadedAt={loadedAt} refreshing={refreshing} />
            </div>
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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Button
              size="sm"
              className="min-w-0 flex-1 gap-1.5 sm:flex-none"
              onClick={handleRequestDocuments}
              disabled={nudging}
            >
              <Icon name="send" size={16} />
              <span className="truncate">
                {nudging ? "Sending..." : "Request documents"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 gap-1.5 sm:flex-none"
              onClick={() => handleTogglePause(detail.nudgesPausedAt !== null)}
              disabled={pausing}
            >
              <Icon name={detail.nudgesPausedAt ? "play_arrow" : "pause"} size={16} />
              <span className="truncate">
                {detail.nudgesPausedAt ? "Resume" : "Pause"}
                <span className="hidden sm:inline"> reminders</span>
              </span>
            </Button>
            <RefreshControl refreshing={refreshing} onRefresh={manualRefresh} />
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
        <div className="border border-danger-border bg-danger-muted px-3 py-2 text-sm text-danger-muted-foreground">
          {actionError.message}
        </div>
      ) : null}

      {nudgeNotice ? (
        <div className="rounded-[12px] border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {nudgeNotice}
        </div>
      ) : null}

      <TabBar
        tab={tab}
        onChange={setTab}
        badges={{ conversations: conversationBadge }}
      />

      {tab === "overview" ? (
        <OverviewTab
          detail={detail}
          subject={subject}
          fields={fields}
          onSaved={manualRefresh}
        />
      ) : null}

      {tab === "activity" ? (
        <>
          <Card className="p-3">
            <NoteComposer
              placeholder="Add a note to this case..."
              onSubmit={(body) => handleAddNote(body)}
            />
          </Card>
          <ActivityTab events={buildActivity(detail, checklist, messages, events)} />
        </>
      ) : null}

      {tab === "conversations" ? (
        <ConversationsTab
          entries={conversation}
          subject={subject}
          onPreview={setPreviewing}
          onReply={handleConversationReply}
        />
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
                  onPreview={setPreviewing}
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

          {/* Files that arrived matching no checklist item - someone sending
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
                    className="flex flex-wrap items-center gap-2 rounded-[12px] border bg-background px-3 py-2"
                  >
                    <Icon
                      name={
                        d.analyzing
                          ? "progress_activity"
                          : d.suggestedLabel
                            ? "auto_awesome"
                            : "help"
                      }
                      size={16}
                      className={`shrink-0 ${
                        d.analyzing
                          ? "animate-spin text-sky-600"
                          : d.suggestedLabel
                            ? "text-info"
                            : "text-muted-foreground"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{d.fileName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[
                          d.sourceChannel
                            ? CHANNEL_LABEL[d.sourceChannel] ?? d.sourceChannel
                            : null,
                          formatDate(d.receivedAt, ""),
                          // What the classifier read, even when it proposed nothing:
                          // "looks like a utility bill" is useful to a human placing
                          // it by hand. Hidden while analyzing so we do not show a
                          // stale reading next to the spinner.
                          d.analyzing
                            ? null
                            : d.classifiedType
                              ? `looks like ${d.classifiedType}`
                              : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {d.analyzing ? (
                        <div className="mt-1.5 space-y-1">
                          <div className="text-xs text-sky-700 dark:text-sky-300">
                            AI is reading this file to match a checklist item…
                          </div>
                          <div
                            className="h-1 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-950"
                            aria-hidden
                          >
                            <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-500/80" />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {d.analyzing ? (
                      <StatusBadge status={d.status} landed={d.uploaded} analyzing />
                    ) : d.suggestedLabel ? (
                      <>
                        <Badge
                          variant="outline"
                          className="whitespace-nowrap border-info-border bg-info-muted text-info-muted-foreground"
                        >
                          {d.suggestedLabel}?
                        </Badge>
                        {d.uploaded ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 px-2 text-xs"
                            disabled={busyId === d.id}
                            onClick={() =>
                              setPreviewing({
                                id: d.id,
                                fileName: d.fileName,
                                mimeType: d.mimeType,
                              })
                            }
                          >
                            <Icon name="visibility" size={14} /> Preview
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 px-2 text-xs"
                          disabled={busyId === d.id}
                          onClick={() => handleConfirmSuggestion(d.id)}
                        >
                          <Icon name="check" size={14} /> File it
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 text-xs"
                          disabled={busyId === d.id}
                          onClick={() => handleDismissSuggestion(d.id)}
                        >
                          Not this
                        </Button>
                      </>
                    ) : (
                      <>
                        <StatusBadge status={d.status} landed={d.uploaded} />
                        {d.uploaded ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 px-2 text-xs"
                              disabled={busyId === d.id}
                              onClick={() =>
                                setPreviewing({
                                  id: d.id,
                                  fileName: d.fileName,
                                  mimeType: d.mimeType,
                                })
                              }
                            >
                              <Icon name="visibility" size={14} /> Preview
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 px-2 text-xs"
                              disabled={busyId === d.id}
                              onClick={() => handleReclassify(d.id)}
                            >
                              <Icon name="auto_awesome" size={14} />
                              {busyId === d.id ? "Looking..." : "Reclassify"}
                            </Button>
                          </>
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

      <DocumentPreviewDialog doc={previewing} onClose={() => setPreviewing(null)} />

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
