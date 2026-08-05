"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/shared/page-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { listStages, listWorkflows } from "@/features/workflows/api";
import type { ApiStage, ApiWorkflow } from "@/features/workflows/api";
import { TONE_CLASS } from "@/lib/tones";
import * as React from "react";

/* ------------------------------------------------------------------ *
 * Workflows - what this workspace actually runs.
 *
 * Read-only on purpose. A workflow's stages, vocabulary and field
 * definitions are what every other screen reads: the board's columns,
 * the create dialog's fields, the checklist's conditions. Editing them
 * is a real feature with real consequences (a live case sitting in a
 * stage somebody deleted), so this shows the configuration honestly and
 * says plainly that changing it is not here yet.
 * ------------------------------------------------------------------ */

function WorkflowCard({ workflow }: { workflow: ApiWorkflow }) {
  const [stages, setStages] = React.useState<ApiStage[] | null>(null);
  const [stageError, setStageError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void listStages(workflow.slug)
      .then((s) => {
        if (!cancelled) setStages(s);
      })
      .catch(() => {
        if (!cancelled) setStageError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workflow.slug]);

  const fields = [...(workflow.fields ?? [])].sort((a, b) => a.order - b.order);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <div className="font-medium">{workflow.name}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Calls its subject a <strong>{workflow.subjectLabel}</strong> and each run an{" "}
            <strong>{workflow.caseLabel}</strong>.
          </p>
        </div>
        <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {workflow.slug}
        </code>
      </div>

      <div className="border-b p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Stages
        </div>
        {stages === null && !stageError ? (
          <Skeleton className="h-7 w-2/3" />
        ) : stageError ? (
          <p className="text-sm text-muted-foreground">Couldn&rsquo;t load stages.</p>
        ) : stages && stages.length > 0 ? (
          // In board order, with the arrows that make it read as a pipeline
          // rather than a set of labels.
          <div className="flex flex-wrap items-center gap-1.5">
            {stages.map((s, i) => (
              <React.Fragment key={s.id}>
                <Badge
                  variant="outline"
                  className={`${TONE_CLASS[s.tone] ?? TONE_CLASS.muted} whitespace-nowrap font-normal`}
                >
                  {s.name}
                </Badge>
                {i < stages.length - 1 ? (
                  <Icon name="chevron_right" size={14} className="text-muted-foreground" />
                ) : null}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No stages configured.</p>
        )}
      </div>

      <div className="p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Fields collected
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom fields - this workflow collects only the subject&rsquo;s name and contact
            details.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Label</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Options</th>
                  <th className="pb-2 font-medium">Shown in table</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.field_key} className="border-t">
                    <td className="py-2 pr-4">
                      <div>{f.label}</div>
                      <code className="text-xs text-muted-foreground">{f.field_key}</code>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {f.input_type}
                      {f.required ? <span className="ml-1 text-red-600">*</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {f.options?.length ? f.options.join(", ") : "-"}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {f.show_in_table ? "Yes" : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function WorkflowsPage() {
  const {
    data: workflows,
    error,
    loading,
  } = useAsyncResource(listWorkflows, [], {
    fallbackError: "Couldn't load workflows.",
  });

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Setup
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Workflows</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The processes this workspace runs - their vocabulary, stages and the fields each one
          collects.
        </p>
      </div>

      <ErrorBanner>{error}</ErrorBanner>

      {/* Said out loud rather than implied by the absence of buttons: this
          screen shows configuration, it does not change it. */}
      <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Icon name="info" size={15} className="mt-0.5 shrink-0" />
        <span>
          Read-only for now. Stages, fields and document checklists are configured by the Docket
          team - editing them here is on the roadmap.
        </span>
      </div>

      {loading && workflows === null && !error ? (
        <Skeleton className="h-48 w-full" />
      ) : workflows && workflows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
          <Icon name="account_tree" size={22} className="text-muted-foreground" />
          <div className="text-sm font-medium">No workflows configured</div>
        </Card>
      ) : (
        (workflows ?? []).map((w) => <WorkflowCard key={w.id} workflow={w} />)
      )}
    </div>
  );
}
