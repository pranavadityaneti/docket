import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { ApiCaseDetail, ApiCaseEvent, ApiCaseMessage, ApiChecklist } from "@/features/case-detail/api";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_LABEL, MESSAGE_KIND_LABEL } from "./meta";

export type ActivityEvent = {
  at: string;
  icon: string;
  title: string;
  detail?: string;
  failed?: boolean;
};

export function buildActivity(detail: ApiCaseDetail, checklist: ApiChecklist, messages: ApiCaseMessage[], journal: ApiCaseEvent[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const itemLabel = new Map(checklist.items.map((item) => [item.requirementId, item.label]));
  for (const event of journal) {
    if (event.kind === "comment") {
      const pin = event.requirementId ? itemLabel.get(event.requirementId) : null;
      events.push({ at: event.createdAt, icon: "sticky_note_2", title: `Note by ${event.authorName ?? "Unknown"}${pin ? ` on “${pin}”` : ""}`, detail: event.body ?? undefined });
    } else if (event.kind === "stage_changed") {
      const data = event.data as { from?: string | null; to?: string };
      events.push({ at: event.createdAt, icon: "arrow_forward", title: `Stage: ${data.from ?? "-"} → ${data.to ?? "?"}`, detail: `by ${event.authorName ?? "Unknown"}` });
    } else if (event.kind === "document_reviewed") {
      const data = event.data as { fileName?: string; status?: string; reason?: string | null };
      events.push({ at: event.createdAt, icon: data.status === "accepted" ? "check_circle" : data.status === "rejected" ? "cancel" : "pending_actions", title: `${data.fileName ?? "Document"} ${data.status ?? "reviewed"}`, detail: `by ${event.authorName ?? "Unknown"}${data.reason ? ` - ${data.reason}` : ""}`, failed: data.status === "rejected" });
    }
  }
  events.push({ at: detail.createdAt, icon: "flag", title: `${detail.caseLabel} created`, detail: detail.source ? `via ${detail.source}` : undefined });
  for (const item of checklist.items) for (const document of item.documents) {
    if (!document.uploaded) continue;
    const bits: string[] = [];
    if (document.sourceChannel) bits.push(`via ${CHANNEL_LABEL[document.sourceChannel] ?? document.sourceChannel}`);
    if (document.classifiedType) bits.push(`AI read it as “${document.classifiedType}”${document.classificationConfidence ? ` (${document.classificationConfidence})` : ""}`);
    bits.push(document.autoFiled ? `filed automatically under “${item.label}”` : `on “${item.label}”`);
    events.push({ at: document.receivedAt, icon: document.autoFiled ? "auto_awesome" : "description", title: `${document.fileName} received`, detail: bits.join(" · ") });
  }
  for (const document of checklist.unclassified) {
    if (!document.uploaded) continue;
    const bits: string[] = [];
    if (document.sourceChannel) bits.push(`via ${CHANNEL_LABEL[document.sourceChannel] ?? document.sourceChannel}`);
    bits.push(document.classifiedType ? `AI read it as “${document.classifiedType}” - awaiting a human` : "not yet matched to a checklist item");
    events.push({ at: document.receivedAt, icon: "help", title: `${document.fileName} received`, detail: bits.join(" · ") });
  }
  for (const message of messages) events.push({ at: message.sentAt, icon: message.channel === "whatsapp" ? "chat" : "mail", title: `${MESSAGE_KIND_LABEL[message.kind] ?? message.kind} ${message.status === "failed" ? "failed" : "sent"} · ${CHANNEL_LABEL[message.channel] ?? message.channel}`, detail: `${message.recipient}${message.status === "failed" && message.error ? ` - ${message.error}` : ""}`, failed: message.status === "failed" });
  if (detail.nudgesPausedAt) events.push({ at: detail.nudgesPausedAt, icon: "pause", title: "Reminders paused" });
  return events.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

export function ActivityTab({ events }: { events: ActivityEvent[] }) {
  return <Card className="gap-0 overflow-hidden py-0"><div className="border-b p-4"><div className="font-medium">Activity</div><p className="text-sm text-muted-foreground">Every touchpoint on this case, newest first.</p></div><div className="flex flex-col p-4">{events.map((event, index) => <div key={`${event.at}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">{index < events.length - 1 ? <div className="absolute left-3.5 top-7 h-[calc(100%-1.25rem)] w-px bg-border" /> : null}<div className={`z-10 flex size-7 shrink-0 items-center justify-center rounded-full border ${event.failed ? "border-danger-border bg-danger-muted text-danger" : "border-transparent bg-muted text-muted-foreground"}`}><Icon name={event.icon} size={14} /></div><div className="min-w-0 flex-1 pt-0.5"><div className="text-sm">{event.title}</div>{event.detail ? <div className="mt-0.5 text-xs text-muted-foreground">{event.detail}</div> : null}<div className="mt-0.5 text-xs text-muted-foreground/70">{formatDateTime(event.at)}</div></div></div>)}</div></Card>;
}
