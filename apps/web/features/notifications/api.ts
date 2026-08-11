import { apiFetch } from "@/lib/http";
import type { PageResult } from "@/features/shared/types";

export type { PageResult } from "@/features/shared/types";

export type NotificationKind =
  | "document_received"
  | "document_needs_review"
  | "unmatched"
  | "follow_up_due"
  | "comment"
  | "stage_changed"
  | "message"
  | "generic";

export type ApiNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  caseId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ListNotificationsOpts = {
  unreadOnly?: boolean;
  kind?: NotificationKind;
  /** Case-insensitive match on title, body, or kind. */
  q?: string;
  limit?: number;
  offset?: number;
};

export function listNotifications(
  opts: ListNotificationsOpts = {},
): Promise<PageResult<ApiNotification>> {
  const params = new URLSearchParams();
  if (opts.unreadOnly) params.set("unreadOnly", "true");
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return apiFetch(`/notifications${qs ? `?${qs}` : ""}`);
}

export function unreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch("/notifications/unread-count");
}

export function markNotificationRead(
  id: string,
): Promise<{ id: string; readAt: string }> {
  return apiFetch(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch("/notifications/read-all", { method: "POST" });
}

export function markCaseNotificationsRead(
  caseId: string,
): Promise<{ updated: number }> {
  return apiFetch(`/notifications/case/${encodeURIComponent(caseId)}/read`, {
    method: "POST",
  });
}

export const NOTIFICATION_KIND_META: Record<
  NotificationKind,
  { icon: string; label: string }
> = {
  document_received: { icon: "attach_file", label: "Document" },
  document_needs_review: { icon: "rate_review", label: "Needs review" },
  unmatched: { icon: "mark_email_unread", label: "Unmatched" },
  follow_up_due: { icon: "campaign", label: "Follow-up" },
  comment: { icon: "sticky_note_2", label: "Note" },
  stage_changed: { icon: "swap_horiz", label: "Stage" },
  message: { icon: "forum", label: "Message" },
  generic: { icon: "notifications", label: "Update" },
};
