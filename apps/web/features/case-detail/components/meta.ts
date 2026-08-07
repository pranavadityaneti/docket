import type { ChecklistItemStatus } from "@/features/case-detail/api";
import {
  DANGER_BANNER,
  SKY_BANNER,
  SUCCESS_BANNER,
  WARNING_BANNER,
} from "@/lib/tones";

export const STATUS_META: Record<
  ChecklistItemStatus,
  { label: string; tone: string; icon: string }
> = {
  missing: {
    label: "Not received",
    tone: "border-border bg-muted text-muted-foreground",
    icon: "radio_button_unchecked",
  },
  received: { label: "Received", tone: SKY_BANNER, icon: "inbox" },
  needs_review: {
    label: "Needs review",
    tone: WARNING_BANNER,
    icon: "pending_actions",
  },
  accepted: { label: "Accepted", tone: SUCCESS_BANNER, icon: "check_circle" },
  rejected: { label: "Rejected", tone: DANGER_BANNER, icon: "cancel" },
  expired: { label: "Expired", tone: WARNING_BANNER, icon: "schedule" },
};

export const INCOMPLETE_META = {
  label: "Incomplete",
  tone: WARNING_BANNER,
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
