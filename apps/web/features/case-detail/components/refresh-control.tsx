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
      <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
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
        aria-label="Refresh"
      >
        <Icon
          name="refresh"
          size={15}
          className={refreshing ? "animate-spin" : undefined}
        />
        <span className="hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}
