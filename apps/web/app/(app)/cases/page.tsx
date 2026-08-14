"use client";

import { ListPager } from "@/components/shared/list-pager";
import { LoadErrorState } from "@/components/shared/page-state";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { createCase, listAllCases, listCases, updateCaseStage } from "@/features/cases/api";
import {
  AllCasesView,
  BoardView,
  CreateLeadDialog,
  tableFields,
  toLead,
  VIEWS,
  WORKFLOW_STORAGE_KEY,
  WorkflowSelect,
  type Lead,
  type Stage,
  type View,
} from "@/features/cases/components";
import type { ApiStage, ApiWorkflow } from "@/features/workflows/api";
import { listStages, listWorkflows } from "@/features/workflows/api";
import { plural } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

const TABLE_PAGE_SIZE = 50;

function CasesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = React.useState<View>("Table");
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [stages, setStages] = React.useState<ApiStage[]>([]);
  // The tenant's workflow, kept so every label on this screen comes from
  // configuration rather than a hardcoded lending word.
  const [workflow, setWorkflow] = React.useState<ApiWorkflow | null>(null);
  // Every workflow the tenant runs, and which one this screen is showing.
  // With one workflow this is invisible plumbing; with two or more, the
  // switcher in the header drives it. Persisted so navigating away and back
  // (or a mid-demo reload) doesn't silently snap to the first workflow.
  const [workflows, setWorkflows] = React.useState<ApiWorkflow[]>([]);
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const refreshGen = React.useRef(0);

  // No auth checks here by design: AppChrome won't render this page without a
  // session, and it redirects centrally if the API rejects the token. These
  // handlers only swallow AuthRequiredError so a redirect-in-flight doesn't
  // also flash an error card.

  // Load leads + stages from the live API (apps/api) - tenant-scoped via RLS.
  // Mirrors the schema defaults, so the first paint - before workflows load -
  // shows a neutral word rather than flashing a lending term at a college.
  // Declared here, above the callbacks that read it.
  const subjectLabel = workflow?.subjectLabel ?? "Contact";
  const caseLabel = workflow?.caseLabel ?? "Case";
  // The domain columns this workflow declares. Empty until workflows load, and
  // legitimately empty for a workflow with no field config - both render a table
  // with no domain columns rather than a lending guess.
  const domainFields = React.useMemo(() => tableFields(workflow), [workflow]);

  const refresh = React.useCallback(async () => {
    const gen = ++refreshGen.current;
    setLoading(true);
    setError(null);
    try {
      // Workflows FIRST: once a tenant runs more than one, every other read
      // needs a slug - listCases() with no slug is an error the moment a
      // second workflow exists, which is exactly the trap this used to have.
      const all = await listWorkflows();
      if (gen !== refreshGen.current) return;
      setWorkflows(all);

      // Which workflow to show: the current selection if it still exists,
      // else the persisted choice, else the first. Nothing here guesses a
      // slug - the list is the authority.
      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem(WORKFLOW_STORAGE_KEY) : null;
      const slug =
        (selectedSlug && all.some((w) => w.slug === selectedSlug) && selectedSlug) ||
        (stored && all.some((w) => w.slug === stored) && stored) ||
        all[0]?.slug ||
        null;
      if (gen !== refreshGen.current) return;
      if (slug !== selectedSlug) setSelectedSlug(slug);

      const wf = all.find((w) => w.slug === slug) ?? null;
      if (gen !== refreshGen.current) return;
      setWorkflow(wf);
      // Board needs every card in the pipeline; table stays paginated.
      const casesPromise =
        view === "Board"
          ? listAllCases(slug ?? undefined).then((items) => ({
            items,
            total: items.length,
            limit: items.length,
            offset: 0,
          }))
          : listCases({
            workflow: slug ?? undefined,
            limit: TABLE_PAGE_SIZE,
            offset,
          });
      const [page, stageRows] = await Promise.all([
        casesPromise,
        wf ? listStages(wf.slug) : Promise.resolve([]),
      ]);
      if (gen !== refreshGen.current) return;
      setLeads(page.items.map(toLead));
      setTotal(page.total);
      if (gen !== refreshGen.current) return;
      setStages(stageRows);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      if (gen !== refreshGen.current) return;
      setError(e instanceof Error ? e.message : "Failed to load this workflow.");
    } finally {
      if (gen !== refreshGen.current) return;
      setLoading(false);
    }
  }, [selectedSlug, offset, view]);

  // Move a lead to another stage - optimistic, with revert + message on failure.
  const moveStage = React.useCallback(
    async (leadId: string, toStageId: string, toStageName: Stage) => {
      setMoveError(null);
      const current = leads.find((l) => l.id === leadId)?.stage;
      setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, stage: toStageName } : l)));
      try {
        await updateCaseStage(leadId, toStageId);
      } catch (e) {
        if (current) {
          setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, stage: current } : l)));
        }
        if (e instanceof AuthRequiredError) return;
        setMoveError(
          e instanceof Error
            ? e.message
            : `Couldn't move the ${caseLabel.toLowerCase()}. Please try again.`,
        );
      }
    },
    [leads, caseLabel],
  );

  React.useEffect(() => {
    // Fetching on mount is what an effect is for - synchronising with an
    // external system. refresh() sets loading/error, which the rule flags, but
    // on mount those already equal their initial values so React bails out
    // rather than cascading. Removing the warning properly would mean moving to
    // a data library/route loader - a bigger change than this screen needs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Open the create modal from /cases?new=1 (Home CTA, sidebar "Create new
  // case"). Depend on searchParams so it still fires when you're already on
  // /cases - a mount-only effect silently no-ops on soft navigation.
  React.useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreateOpen(true);
    router.replace("/cases", { scroll: false });
  }, [searchParams, router]);

  return (
    <div className="flex w-full flex-col gap-4 sm:gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Pipeline
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
            Cases
          </h1>
          <p className="text-sm text-muted-foreground">
            Every {subjectLabel.toLowerCase()} in the pipeline, and what each{" "}
            {caseLabel.toLowerCase()} still needs.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <WorkflowSelect
            workflows={workflows}
            selectedSlug={selectedSlug}
            onSelect={(slug) => {
              window.localStorage.setItem(WORKFLOW_STORAGE_KEY, slug);
              refreshGen.current += 1;
              setOffset(0);
              // refresh() depends on selectedSlug, so the effect below re-runs
              // it - one place reloads cases, stages and vocabulary together.
              setSelectedSlug(slug);
            }}
          />
          <Button
            className="min-w-0 flex-1 gap-1.5 sm:flex-none"
            onClick={() => setCreateOpen(true)}
          >
            <Icon name="add" size={18} /> New {caseLabel.toLowerCase()}
          </Button>
        </div>
      </div>

      {/* Display toggle. role=group with aria-pressed, not a tablist: these
          buttons swap how one set of cases is drawn, they do not switch panels. */}
      <SegmentedControl
        aria-label="Case display"
        value={view}
        onChange={(v) => {
          setOffset(0);
          setView(v);
        }}
        options={VIEWS.map((v) => ({
          value: v,
          label: v,
          icon: v === "Table" ? "table_rows" : "view_kanban",
        }))}
      />

      {moveError ? (
        <div className="flex items-center justify-between gap-2 border border-danger-border bg-danger-muted px-3 py-2 text-sm text-danger-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Icon name="error" size={16} /> {moveError}
          </span>
          <button
            onClick={() => setMoveError(null)}
            aria-label="Dismiss"
            className="text-danger/70 hover:text-danger"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}

      {error ? (
        <LoadErrorState
          title={`Couldn't load ${plural(caseLabel).toLowerCase()}`}
          error={error}
          onRetry={refresh}
        />
      ) : loading ? (
        <Card className="flex flex-col items-center gap-3 rounded-[12px] px-6 py-10 text-center text-muted-foreground">
          <Icon name="progress_activity" size={20} className="animate-spin" />
          <span className="text-sm">Loading {plural(caseLabel).toLowerCase()}...</span>
        </Card>
      ) : (
        <>
          {/* Suspense: AllCasesView reads useSearchParams (?q= from the header search). */}
          {view === "Table" ? (
            <React.Suspense>
              <>
                <AllCasesView
                  leads={leads}
                  onRefresh={refresh}
                  subjectLabel={subjectLabel}
                  caseLabel={caseLabel}
                  fields={domainFields}
                  stages={stages}
                  onMoveStage={moveStage}
                />
                {total > TABLE_PAGE_SIZE ? (
                  <Card className="gap-0 overflow-hidden py-0">
                    <ListPager
                      total={total}
                      limit={TABLE_PAGE_SIZE}
                      offset={offset}
                      onPage={setOffset}
                      noun={plural(caseLabel).toLowerCase()}
                    />
                  </Card>
                ) : null}
              </>
            </React.Suspense>
          ) : null}
          {view === "Board" ? (
            <BoardView
              leads={leads}
              stages={stages}
              onMoveStage={moveStage}
              caseLabel={caseLabel}
              fields={domainFields}
            />
          ) : null}
        </>
      )}

      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workflows={workflows}
        selectedSlug={selectedSlug}
        onCreate={async (input) => {
          try {
            // Honour the dialog's "What is this for?" choice. Fall back to the
            // open workflow only when the dialog somehow omitted a slug
            // (single-workflow tenants never show the picker).
            const workflowSlug = input.workflow ?? selectedSlug ?? undefined;
            const created = await createCase({
              ...input,
              workflow: workflowSlug,
            });
            if (
              workflowSlug &&
              workflowSlug !== selectedSlug &&
              typeof window !== "undefined"
            ) {
              setSelectedSlug(workflowSlug);
              window.localStorage.setItem(WORKFLOW_STORAGE_KEY, workflowSlug);
            }
            // Straight to the checklist. Creating a case and then hunting for
            // it in the table is the wrong next step - what the case needs is
            // the only reason it was created.
            router.push(`/cases/${created.id}`);
          } catch (e) {
            if (e instanceof AuthRequiredError) return; // AppChrome redirects
            throw e; // let the dialog show its own inline error
          }
        }}
      />
    </div>
  );
}

export default function CasesPageRoute() {
  // useSearchParams (create-from-?new=1 + table filters) needs a Suspense boundary.
  return (
    <React.Suspense>
      <CasesPage />
    </React.Suspense>
  );
}
