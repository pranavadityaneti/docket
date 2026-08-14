import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import type { ChecklistItemStatus } from "@/features/case-detail/api";
import { INCOMPLETE_META, STATUS_META } from "./meta";

export function AnalyzingBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 whitespace-nowrap border-sky-border bg-sky-muted font-normal text-sky-muted-foreground"
    >
      <Icon name="progress_activity" size={13} className="animate-spin" />
      Analyzing
    </Badge>
  );
}

export function StatusBadge({
  status,
  landed = true,
  analyzing = false,
}: {
  status: ChecklistItemStatus;
  landed?: boolean;
  analyzing?: boolean;
}) {
  if (analyzing) return <AnalyzingBadge />;
  const meta = landed ? STATUS_META[status] : INCOMPLETE_META;
  return (
    <Badge
      variant="outline"
      className={`${meta.tone} gap-1 whitespace-nowrap font-normal`}
    >
      <Icon name={meta.icon} size={13} />
      {meta.label}
    </Badge>
  );
}
