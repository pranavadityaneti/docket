"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type Props = {
  total: number;
  limit: number;
  offset: number;
  onPage: (nextOffset: number) => void;
  noun?: string;
};

/** Prev/next for offset-based list pages. */
export function ListPager({ total, limit, offset, onPage, noun = "items" }: Props) {
  if (total <= limit) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const prev = Math.max(0, offset - limit);
  const next = offset + limit;
  const canPrev = offset > 0;
  const canNext = next < total;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
      <span className="text-sm tabular-nums text-muted-foreground">
        {from}–{to} of {total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrev}
          className="gap-1"
          onClick={() => onPage(prev)}
        >
          <Icon name="chevron_left" size={16} /> Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext}
          className="gap-1"
          onClick={() => onPage(next)}
        >
          Next <Icon name="chevron_right" size={16} />
        </Button>
      </div>
    </div>
  );
}
