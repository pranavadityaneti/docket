"use client";

import { Icon } from "@/components/ui/icon";
import { TABS, type CaseTab } from "./meta";

export function TabBar({
  tab,
  onChange,
  badges,
}: {
  tab: CaseTab;
  onChange: (t: CaseTab) => void;
  /** Unread / attention counts keyed by tab. Zero / missing hides the badge. */
  badges?: Partial<Record<CaseTab, number>>;
}) {
  return (
    <div
      className="-mx-3 flex gap-1 overflow-x-auto border-b px-3 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {TABS.map((t) => {
        const count = badges?.[t.key] ?? 0;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => onChange(t.key)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm transition-colors sm:px-3 ${tab === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
            {count > 0 ? (
              <span
                className="inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground"
                aria-label={`${count} new`}
              >
                {count > 9 ? "9+" : count}
              </span>
            ) : null}
            {t.key === "calls" ? (
              <span className="rounded-full border bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                soon
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
