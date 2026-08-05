"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { ApiFieldDef, ApiStage } from "@/features/workflows/api";
import { plural } from "@/lib/format";
import * as React from "react";
import { cellValue, type Lead, type Stage } from "./types";

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
          const stage = stageItem.name;
          const items = leads.filter((lead) => lead.stage === stage);
          return (
            <div
              key={stageItem.id}
              className="flex w-72 shrink-0 flex-col overflow-hidden rounded-[12px] border bg-card"
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <span className="truncate text-sm font-medium">{stage}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="flex min-h-24 flex-col gap-2 p-2">
                {items.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    No {plural(caseLabel).toLowerCase()}
                  </div>
                ) : (
                  items.map((lead) => (
                    <div
                      key={lead.id}
                      className="rounded-[8px] border border-border bg-card p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {lead.name}
                        </span>
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
                      <label className="mt-2 flex items-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
                        <Icon
                          name="swap_vert"
                          size={14}
                          className="shrink-0"
                        />
                        <select
                          value={lead.stage}
                          disabled={!stages.length}
                          onChange={(event) => {
                            const name = event.target.value as Stage;
                            const id = stageIdByName.get(name);
                            if (id && name !== lead.stage) {
                              onMoveStage(lead.id, id, name);
                            }
                          }}
                          aria-label={`Move ${lead.name} to another stage`}
                          className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-1.5 py-1 text-[11px] text-foreground outline-none focus-visible:border-ring disabled:opacity-50"
                        >
                          {options.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
