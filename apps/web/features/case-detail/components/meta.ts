import type { ChecklistItemStatus } from "@/features/case-detail/api";

export const STATUS_META: Record<
  ChecklistItemStatus,
  { label: string; tone: string; icon: string }
> = {
  missing: { label: "Not received", tone: "border-border bg-muted text-muted-foreground", icon: "radio_button_unchecked" },
  received: { label: "Received", tone: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300", icon: "inbox" },
  needs_review: { label: "Needs review", tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300", icon: "pending_actions" },
  accepted: { label: "Accepted", tone: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300", icon: "check_circle" },
  rejected: { label: "Rejected", tone: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300", icon: "cancel" },
  expired: { label: "Expired", tone: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300", icon: "schedule" },
};

export const INCOMPLETE_META = {
  label: "Incomplete",
  tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  icon: "error_outline",
};

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  upload: "Uploaded here",
  import: "Imported",
  api: "API",
};

export const MESSAGE_KIND_LABEL: Record<string, string> = {
  initial: "Initial request",
  reminder: "Reminder",
  manual: "Manual request",
};

export type PreviewTarget = {
  id: string;
  fileName: string;
  mimeType: string | null;
};

export type ActionError = { id: string | null; message: string };

export type CaseTab =
  | "overview"
  | "checklist"
  | "conversations"
  | "activity"
  | "calls";

export const TABS: { key: CaseTab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "person" },
  { key: "checklist", label: "Checklist", icon: "checklist" },
  { key: "conversations", label: "Conversations", icon: "forum" },
  { key: "activity", label: "Activity", icon: "timeline" },
  { key: "calls", label: "Calls", icon: "call" },
];

export function parseCaseTab(raw: string | null): CaseTab {
  if (raw && TABS.some((tab) => tab.key === raw)) return raw as CaseTab;
  return "checklist";
}

export function previewKind(
  fileName: string,
  mimeType: string | null,
): "image" | "pdf" | "other" {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || mime === "application/x-pdf") return "pdf";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif"].includes(ext)) {
    return "image";
  }
  if (ext === "pdf") return "pdf";
  return "other";
}
