import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { agoFromMs } from "@/lib/format";

export function RefreshControl({
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
        {refreshing
          ? "Checking…"
          : loadedAt
            ? `Updated ${agoFromMs(loadedAt)}`
            : ""}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <Icon
          name="refresh"
          size={15}
          className={refreshing ? "animate-spin" : undefined}
        />
        Refresh
      </Button>
    </div>
  );
}
