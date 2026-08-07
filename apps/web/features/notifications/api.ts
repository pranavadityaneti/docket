import { apiFetch } from "@/lib/http";

export type NotificationKind =
  | "document_received"
  | "document_needs_review"
  | "unmatched"
  | "follow_up_due"
  | "comment"
  | "stage_changed"
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

export function listNotifications(opts?: {
  unreadOnly?: boolean;
  kind?: NotificationKind;
}): Promise<ApiNotification[]> {
  const params = new URLSearchParams();
  if (opts?.unreadOnly) params.set("unreadOnly", "true");
  if (opts?.kind) params.set("kind", opts.kind);
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
  generic: { icon: "notifications", label: "Update" },
};
