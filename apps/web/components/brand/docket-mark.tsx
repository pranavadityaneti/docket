import { cn } from "@/lib/utils";

export const DOCKET_MARK_SRC = "/logo.svg";

/** Brand lockup from `public/logo.svg`. */
export function DocketMark({ className }: { className?: string }) {
  return (
    <img
      src={DOCKET_MARK_SRC}
      alt="Docket"
      className={cn("inline-block h-6 w-auto", className)}
    />
  );
}

export function DocketWatermark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs tracking-wide text-muted-foreground",
        className,
      )}
    >
      Powered by
      <DocketMark className="h-6" />
    </span>
  );
}
