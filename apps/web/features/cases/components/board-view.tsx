"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { SelectMenu } from "@/components/shared/select-menu";
import type { ApiFieldDef, ApiStage } from "@/features/workflows/api";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";
import * as React from "react";
import { cellValue, type Lead, type Stage } from "./types";

/** MIME-style key so other page drops ignore this payload. */
export const BOARD_DRAG_MIME = "application/x-docket-board-case";

export type BoardDragPayload = {
  leadId: string;
  fromStage: string;
};

export function parseBoardDragPayload(raw: string): BoardDragPayload | null {
  try {
    const data = JSON.parse(raw) as Partial<BoardDragPayload>;
    if (
      typeof data.leadId !== "string" ||
      !data.leadId ||
      typeof data.fromStage !== "string" ||
      !data.fromStage
    ) {
      return null;
    }
    return { leadId: data.leadId, fromStage: data.fromStage };
  } catch {
    return null;
  }
}

/** Drop only moves when the column is a different stage than where it started. */
export function shouldMoveOnDrop(
  payload: BoardDragPayload,
  toStageName: string,
): boolean {
  return payload.fromStage !== toStageName;
}

function BoardCard({
  lead,
  stages,
  stageIdByName,
  options,
  headline,
  chip,
  onMoveStage,
  draggingId,
  setDraggingId,
}: {
  lead: Lead;
  stages: ApiStage[];
  stageIdByName: Map<string, string>;
  options: readonly string[];
  headline: ApiFieldDef | undefined;
  chip: ApiFieldDef | undefined;
  onMoveStage: (leadId: string, toStageId: string, toStageName: Stage) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        const target = event.target as HTMLElement | null;
        // Select / interactive controls use their own pointer - don't steal.
        if (target?.closest("select, label, button, a, input, textarea, [data-slot='dropdown-menu-trigger']")) {
          event.preventDefault();
          return;
        }
        const payload: BoardDragPayload = {
          leadId: lead.id,
          fromStage: lead.stage,
        };
        event.dataTransfer.setData(BOARD_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
        setDraggingId(lead.id);
      }}
      onDragEnd={() => {
        setDraggingId(null);
      }}
      className={cn(
        "cursor-grab rounded-[8px] border border-border bg-card p-3 text-foreground active:cursor-grabbing",
        draggingId === lead.id && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{lead.name}</span>
        {headline ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {cellValue(lead.data, headline)}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {lead.company} · {lead.reference}
      </div>
      {chip ? (
        <div className="mt-2 flex items-center gap-1.5">
          <Badge
            variant="outline"
            className="border-transparent bg-pastel-mint text-[11px] font-normal text-pastel-mint-fg"
          >
            {cellValue(lead.data, chip)}
          </Badge>
        </div>
      ) : null}
      <label className="mt-2 flex cursor-pointer items-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
        <Icon name="swap_vert" size={14} className="shrink-0" />
        <SelectMenu
          size="sm"
          value={lead.stage}
          disabled={!stages.length}
          aria-label={`Move ${lead.name} to another stage`}
          className="min-w-0 flex-1"
          options={options.map((name) => ({ value: name, label: name }))}
          onChange={(next) => {
            const name = next as Stage;
            const id = stageIdByName.get(name);
            if (id && name !== lead.stage) {
              onMoveStage(lead.id, id, name);
            }
          }}
        />
      </label>
    </div>
  );
}

function BoardColumn({
  stageItem,
  items,
  caseLabel,
  stages,
  stageIdByName,
  options,
  headline,
  chip,
  onMoveStage,
  draggingId,
  setDraggingId,
}: {
  stageItem: ApiStage;
  items: Lead[];
  caseLabel: string;
  stages: ApiStage[];
  stageIdByName: Map<string, string>;
  options: readonly string[];
  headline: ApiFieldDef | undefined;
  chip: ApiFieldDef | undefined;
  onMoveStage: (leadId: string, toStageId: string, toStageName: Stage) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
}) {
  const [isOver, setIsOver] = React.useState(false);
  const stage = stageItem.name;

  function acceptDrop(event: React.DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsOver(false);
    const payload = parseBoardDragPayload(
      event.dataTransfer.getData(BOARD_DRAG_MIME),
    );
    // Clear the drag fade BEFORE the optimistic stage update. Moving the card
    // to another column unmounts the drag source, and dragend never runs — the
    // card stayed at opacity-50 forever (looked "disabled").
    setDraggingId(null);
    if (!payload) return;
    if (!shouldMoveOnDrop(payload, stage)) return;
    const toId = stageIdByName.get(stage);
    if (!toId) return;
    onMoveStage(payload.leadId, toId, stage as Stage);
  }

  return (
    <div
      className={cn(
        "flex w-[min(18rem,calc(100vw-2.5rem))] shrink-0 flex-col overflow-hidden rounded-[12px] border bg-card transition-colors",
        isOver && "border-primary bg-primary/5",
      )}
      onDragOver={(event) => {
        // Prefer live drag state - custom MIME often missing from
        // dataTransfer.types mid-drag in Safari.
        if (!draggingId && ![...event.dataTransfer.types].includes(BOARD_DRAG_MIME)) {
          return;
        }
        acceptDrop(event);
        setIsOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <span className="truncate text-sm font-medium">{stage}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      <div className="flex min-h-24 flex-col gap-2 p-2">
        {items.length === 0 ? (
          <div
            className={cn(
              "rounded-[8px] border border-dashed py-6 text-center text-xs text-muted-foreground",
              isOver && "border-primary/40 text-primary",
            )}
          >
            {isOver
              ? `Drop here`
              : `No ${plural(caseLabel).toLowerCase()}`}
          </div>
        ) : (
          items.map((lead) => (
            <BoardCard
              key={lead.id}
              lead={lead}
              stages={stages}
              stageIdByName={stageIdByName}
              options={options}
              headline={headline}
              chip={chip}
              onMoveStage={onMoveStage}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function BoardView({
  leads,
  stages,
  onMoveStage,
  caseLabel,
  fields,
}: {
  leads: Lead[];
  stages: ApiStage[];
  onMoveStage: (leadId: string, toStageId: string, toStageName: Stage) => void;
  caseLabel: string;
  fields: ApiFieldDef[];
}) {
  const stageIdByName = React.useMemo(
    () => new Map(stages.map((stage) => [stage.name, stage.id])),
    [stages],
  );
  const options: readonly string[] = stages.map((stage) => stage.name);
  const [headline, chip] = fields;
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  // Belt-and-suspenders: if the drag source unmounts mid-drop, React's
  // onDragEnd may never fire - still reset the faded state.
  React.useEffect(() => {
    if (!draggingId) return;
    const clear = () => setDraggingId(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, [draggingId]);

  if (stages.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
        <div className="text-sm font-medium">
          This workflow has no stages yet
        </div>
        <p className="text-sm text-muted-foreground">
          Add stages to the workflow to use the board.
        </p>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3">
        {stages.map((stageItem) => {
          const items = leads.filter((lead) => lead.stage === stageItem.name);
          return (
            <BoardColumn
              key={stageItem.id}
              stageItem={stageItem}
              items={items}
              caseLabel={caseLabel}
              stages={stages}
              stageIdByName={stageIdByName}
              options={options}
              headline={headline}
              chip={chip}
              onMoveStage={onMoveStage}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
            />
          );
        })}
      </div>
    </div>
  );
}
