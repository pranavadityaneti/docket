"use client";

import { Icon } from "@/components/ui/icon";
import { TABS, type CaseTab } from "./meta";

export function TabBar({ tab, onChange }: { tab: CaseTab; onChange: (t: CaseTab) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${tab === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
          {t.key === "calls" ? (
            <span className="rounded-full border bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              soon
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
