"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner, NoticeBanner } from "@/components/shared/page-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { AuthRequiredError, getStoredProfile } from "@/lib/http";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/tones";
import {
  canEditWorkflows,
  createWorkflow,
  deleteWorkflow,
  listStages,
  listWorkflows,
  type ApiFieldDef,
  type ApiStage,
  type ApiWorkflow,
} from "@/features/workflows/api";
import Link from "next/link";
import * as React from "react";
import { useRouter } from "next/navigation";

function slugPreview(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function fieldIcon(field: ApiFieldDef): string {
  if (field.format === "inr") return "currency_rupee";
  if (field.input_type === "dropdown") return "list";
  if (field.input_type === "number" || field.field_type === "integer") {
    return "tag";
  }
  if (field.input_type === "textarea") return "notes";
  return "text_fields";
}

function fieldTypeHint(field: ApiFieldDef): string {
  if (field.format === "inr") return "₹";
  if (field.input_type === "dropdown") return "list";
  if (field.input_type === "number" || field.field_type === "integer") {
    return "number";
  }
  if (field.input_type === "textarea") return "long text";
  return "text";
}

function SectionLabel({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {children}
      </span>
      {typeof count === "number" ? (
        <span className="tabular-nums text-[11px] text-muted-foreground/80">
          {count}
        </span>
      ) : null}
    </div>
  );
}

function StagesPipeline({ stages }: { stages: ApiStage[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <ol className="flex min-w-min items-stretch gap-0">
        {stages.map((s, i) => {
          const tone = TONE_CLASS[s.tone] ?? TONE_CLASS.muted;
          const isLast = i === stages.length - 1;
          return (
            <li key={s.id} className="flex items-center">
              <div
                className={cn(
                  "flex max-w-[11rem] items-center gap-2 rounded-[12px] px-2.5 py-1.5",
                  tone,
                )}
                title={s.name}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-background/55 text-[10px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="truncate text-xs font-medium leading-snug">
                  {s.name}
                </span>
              </div>
              {!isLast ? (
                <div
                  className="mx-1 flex w-4 shrink-0 items-center justify-center"
                  aria-hidden
                >
                  <div className="h-px w-full bg-border" />
                  <Icon
                    name="chevron_right"
                    size={12}
                    className="-ml-1 text-muted-foreground/70"
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FieldsCollected({ fields }: { fields: ApiFieldDef[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {fields.map((f) => (
        <span
          key={f.field_key}
          title={`${f.label} · ${fieldTypeHint(f)}${f.required ? " · required" : ""}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-[12px] border border-border/80 bg-muted/40 px-2.5 py-1.5 text-xs text-foreground"
        >
          <Icon
            name={fieldIcon(f)}
            size={14}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate font-medium">{f.label}</span>
          {f.required ? (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide text-danger"
              aria-label="Required"
            >
              req
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function WorkflowCard({
  workflow,
  canEdit,
  onDeleted,
}: {
  workflow: ApiWorkflow;
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const [stages, setStages] = React.useState<ApiStage[] | null>(null);
  const [stageError, setStageError] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

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

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWorkflow(workflow.slug);
      setConfirmOpen(false);
      onDeleted();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete that workflow.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <Link
            href={`/workflows/${encodeURIComponent(workflow.slug)}`}
            className="font-medium hover:underline"
          >
            {workflow.name}
          </Link>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Calls its subject a <strong>{workflow.subjectLabel}</strong> and each
            run a <strong>{workflow.caseLabel}</strong>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {workflow.stageCount ?? stages?.length ?? "…"} stages · {fields.length}{" "}
            fields · {workflow.requirementCount ?? 0} checklist items
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            {workflow.slug}
          </code>
          <Link
            href={`/workflows/${encodeURIComponent(workflow.slug)}`}
            className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
          >
            {canEdit ? "Edit" : "View"}
          </Link>
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                setDeleteError(null);
                setConfirmOpen(true);
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border-b bg-muted/20 p-4">
        <SectionLabel count={stages?.length}>Stages</SectionLabel>
        {stages === null && !stageError ? (
          <Skeleton className="h-9 w-2/3 rounded-[12px]" />
        ) : stageError ? (
          <p className="text-sm text-muted-foreground">Couldn&rsquo;t load stages.</p>
        ) : stages && stages.length > 0 ? (
          <StagesPipeline stages={stages} />
        ) : (
          <p className="text-sm text-muted-foreground">No stages configured.</p>
        )}
      </div>

      <div className="p-4">
        <SectionLabel count={fields.length}>Fields collected</SectionLabel>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom fields - this workflow collects only the subject&rsquo;s name
            and contact details.
          </p>
        ) : (
          <FieldsCollected fields={fields} />
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {workflow.name}?</DialogTitle>
            <DialogDescription>
              This removes the workflow, its stages, fields and checklist. It is
              blocked if any cases still exist under it.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="px-5 text-sm text-destructive">{deleteError}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NewWorkflowDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [subjectLabel, setSubjectLabel] = React.useState("Contact");
  const [caseLabel, setCaseLabel] = React.useState("Case");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setSlugTouched(false);
    setSubjectLabel("Contact");
    setCaseLabel("Case");
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const wf = await createWorkflow({
        name: name.trim(),
        slug: slug.trim() || undefined,
        subjectLabel: subjectLabel.trim(),
        caseLabel: caseLabel.trim(),
      });
      onOpenChange(false);
      onCreated(wf.slug);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't create workflow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              A process this workspace runs - you can add stages, fields and a
              document checklist after creating it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5 pb-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Name</span>
              <Input
                value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  if (!slugTouched) setSlug(slugPreview(v));
                }}
                required
                autoFocus
                maxLength={120}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Slug</span>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                placeholder="derived-from-name"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={64}
              />
              <span className="text-xs text-muted-foreground">
                Locked after create. Used in URLs and APIs.
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Subject label</span>
                <Input
                  value={subjectLabel}
                  onChange={(e) => setSubjectLabel(e.target.value)}
                  required
                  maxLength={64}
                  placeholder="Contact, Borrower, Student…"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Case label</span>
                <Input
                  value={caseLabel}
                  onChange={(e) => setCaseLabel(e.target.value)}
                  required
                  maxLength={64}
                  placeholder="Case"
                />
              </label>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkflowsPage() {
  const canEdit = canEditWorkflows(getStoredProfile()?.role);
  const router = useRouter();
  const [newOpen, setNewOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const {
    data: workflows,
    error,
    loading,
    reload,
  } = useAsyncResource(listWorkflows, [], {
    fallbackError: "Couldn't load workflows.",
  });

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Setup
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Workflows</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The processes this workspace runs - their vocabulary, stages and the
            fields each one collects.
          </p>
        </div>
        {canEdit ? (
          <Button className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Icon name="add" size={16} />
            New workflow
          </Button>
        ) : null}
      </div>

      <ErrorBanner>{error}</ErrorBanner>
      <NoticeBanner>{notice}</NoticeBanner>

      {!canEdit ? (
        <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Icon name="info" size={15} className="mt-0.5 shrink-0" />
          <span>
            You can view workflow configuration. Owners and admins can edit it.
          </span>
        </div>
      ) : null}

      {loading && workflows === null && !error ? (
        <Skeleton className="h-48 w-full" />
      ) : workflows && workflows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
          <Icon name="account_tree" size={22} className="text-muted-foreground" />
          <div className="text-sm font-medium">No workflows configured</div>
          {canEdit ? (
            <Button size="sm" className="mt-2" onClick={() => setNewOpen(true)}>
              Create the first one
            </Button>
          ) : null}
        </Card>
      ) : (
        (workflows ?? []).map((w) => (
          <WorkflowCard
            key={w.id}
            workflow={w}
            canEdit={canEdit}
            onDeleted={() => {
              setNotice(`Deleted ${w.name}.`);
              reload();
            }}
          />
        ))
      )}

      <NewWorkflowDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(slug) => {
          setNotice("Workflow created - finish stages, fields and the checklist.");
          reload();
          router.push(`/workflows/${encodeURIComponent(slug)}`);
        }}
      />
    </div>
  );
}
