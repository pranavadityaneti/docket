"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ApiWorkflow } from "@/features/workflows/api";
import * as React from "react";

export function WorkflowSelect({
  workflows,
  selectedSlug,
  onSelect,
}: {
  workflows: ApiWorkflow[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (workflows.length < 2) return null;
  const selected = workflows.find((workflow) => workflow.slug === selectedSlug)
    ?? workflows[0];
  return (
    <div className="relative max-w-full">
      <Button
        variant="outline"
        className="max-w-full gap-2"
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="truncate">{selected.name}</span>
        <Icon
          name="expand_more"
          size={16}
          className="shrink-0 text-muted-foreground"
        />
      </Button>
      {open ? (
        <>
          <button
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 right-auto top-full z-50 mt-1 w-[min(15rem,calc(100vw-2rem))] rounded-md border border-border bg-popover p-1 text-popover-foreground sm:left-auto sm:right-0">
            {workflows.map((workflow) => (
              <button
                key={workflow.slug}
                onClick={() => {
                  setOpen(false);
                  if (workflow.slug !== selected.slug) onSelect(workflow.slug);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{workflow.name}</span>
                {selected.slug === workflow.slug ? (
                  <Icon name="check" size={16} className="shrink-0 text-primary" />
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
