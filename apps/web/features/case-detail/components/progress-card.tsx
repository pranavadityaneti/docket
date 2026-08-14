import { Card } from "@/components/ui/card";
import type { ApiChecklist } from "@/features/case-detail/api";

export function ProgressCard({
  summary,
  subjectLabel,
}: {
  summary: ApiChecklist["summary"];
  subjectLabel: string;
}) {
  const pct =
    summary.required === 0
      ? 100
      : Math.round((summary.accepted / summary.required) * 100);
  const done =
    summary.required > 0 && summary.accepted === summary.required;

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium">Collection progress</div>
        <div className="text-sm tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">
            {summary.accepted}
          </span>{" "}
          of {summary.required} required accepted
        </div>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Required documents accepted"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            done ? "bg-success" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {summary.outstanding}
          </span>{" "}
          still to chase
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {summary.awaitingReview}
          </span>{" "}
          waiting on you
        </span>
        {done ? (
          <span className="text-success">
            Everything required is in - nothing to ask the{" "}
            {subjectLabel.toLowerCase()} for.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
