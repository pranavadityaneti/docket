import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { agoFromMs } from "@/lib/format";

export function UpdatedAgo({
  loadedAt,
  refreshing,
}: {
  loadedAt: number | null;
  refreshing: boolean;
}) {
  const label = refreshing
    ? "Checking..."
    : loadedAt
      ? `Updated ${agoFromMs(loadedAt)}`
      : null;
  if (!label) return null;
  return (
    <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
  );
}

export function RefreshControl({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
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
  );
}
