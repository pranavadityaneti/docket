"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listWorkflows,
  listStages,
  AuthRequiredError,
  type ApiWorkflow,
  type ApiStage,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Workflows — what this workspace actually runs.
 *
 * Read-only on purpose. A workflow's stages, vocabulary and field
 * definitions are what every other screen reads: the board's columns,
 * the create dialog's fields, the checklist's conditions. Editing them
 * is a real feature with real consequences (a live case sitting in a
 * stage somebody deleted), so this shows the configuration honestly and
 * says plainly that changing it is not here yet.
 * ------------------------------------------------------------------ */

const TONE_CLASS: Record<string, string> = {
  muted: "border-border bg-muted text-muted-foreground",
  teal: "border-primary/20 bg-primary/10 text-primary",
  primary: "border-primary/20 bg-primary/10 text-primary",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  red: "border-red-200 bg-red-50 text-red-700",
};

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
            No custom fields — this workflow collects only the subject&rsquo;s name and contact
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
                      {f.options?.length ? f.options.join(", ") : "—"}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {f.show_in_table ? "Yes" : "—"}
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
  const [workflows, setWorkflows] = React.useState<ApiWorkflow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void listWorkflows()
      .then((ws) => {
        if (!cancelled) setWorkflows(ws);
      })
      .catch((e) => {
        if (cancelled || e instanceof AuthRequiredError) return;
        setError(e instanceof Error ? e.message : "Couldn't load workflows.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The processes this workspace runs — their vocabulary, stages and the fields each one
          collects.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Said out loud rather than implied by the absence of buttons: this
          screen shows configuration, it does not change it. */}
      <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Icon name="info" size={15} className="mt-0.5 shrink-0" />
        <span>
          Read-only for now. Stages, fields and document checklists are configured by the Docket
          team — editing them here is on the roadmap.
        </span>
      </div>

      {workflows === null && !error ? (
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
