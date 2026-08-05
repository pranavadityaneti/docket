import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import type { ChecklistItemStatus } from "@/features/case-detail/api";
import { INCOMPLETE_META, STATUS_META } from "./meta";

export function StatusBadge({
  status,
  landed = true,
}: {
  status: ChecklistItemStatus;
  landed?: boolean;
}) {
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
