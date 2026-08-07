"use client";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FIELD_CLASS } from "@/components/shared/case-fields";
import { SelectMenu } from "@/components/shared/select-menu";
import { ErrorBanner, NoticeBanner } from "@/components/shared/page-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  canEditWorkflows,
  getWorkflow,
  listFields,
  listRequirements,
  listStages,
  putFields,
  putRequirements,
  putStages,
  updateWorkflow,
  type ApiFieldDef,
  type ApiRequirement,
  type ApiStage,
  type ApiWorkflow,
} from "@/features/workflows/api";
import {
  snapFields,
  snapIdentity,
  snapRequirements,
  snapStages,
  type DraftField,
  type DraftReq,
  type DraftStage,
} from "@/features/workflows/draft-snapshots";
import { AuthRequiredError, getStoredProfile } from "@/lib/http";
import { toneSwatch } from "@/lib/tones";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

const TONES = ["muted", "teal", "primary", "amber", "orange", "green", "red"] as const;

function newId() {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}

function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([^a-z])/, "f_$1")
    .slice(0, 64);
}

function TonePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (tone: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              FIELD_CLASS,
              "flex w-full items-center gap-2 text-left disabled:opacity-50",
            )}
          />
        }
      >
        <span
          className={cn(
            "size-3.5 shrink-0 rounded-full ring-1 ring-black/10",
            toneSwatch(value),
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <Icon name="expand_more" size={16} className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40 rounded-[12px]">
        <DropdownMenuGroup>
          {TONES.map((t) => (
            <DropdownMenuItem
              key={t}
              className="gap-2"
              onClick={() => onChange(t)}
            >
              <span
                className={cn(
                  "size-3.5 shrink-0 rounded-full ring-1 ring-black/10",
                  toneSwatch(t),
                )}
                aria-hidden
              />
              <span className="flex-1">{t}</span>
              {t === value ? (
                <Icon name="check" size={14} className="text-primary" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
      <div>
        <div className="font-medium">{title}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}

export default function WorkflowEditorPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug ?? "");
  const canEdit = canEditWorkflows(getStoredProfile()?.role);

  const [workflow, setWorkflow] = React.useState<ApiWorkflow | null>(null);
  const [name, setName] = React.useState("");
  const [subjectLabel, setSubjectLabel] = React.useState("");
  const [caseLabel, setCaseLabel] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [stages, setStages] = React.useState<DraftStage[]>([]);
  const [fields, setFields] = React.useState<DraftField[]>([]);
  const [reqs, setReqs] = React.useState<DraftReq[]>([]);

  const [baseIdentity, setBaseIdentity] = React.useState("");
  const [baseStages, setBaseStages] = React.useState("");
  const [baseFields, setBaseFields] = React.useState("");
  const [baseReqs, setBaseReqs] = React.useState("");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wf, st, fl, rq] = await Promise.all([
        getWorkflow(slug),
        listStages(slug),
        listFields(slug),
        listRequirements(slug),
      ]);
      setWorkflow(wf);
      setName(wf.name);
      setSubjectLabel(wf.subjectLabel);
      setCaseLabel(wf.caseLabel);
      setDescription(wf.description ?? "");
      setBaseIdentity(
        snapIdentity(
          wf.name,
          wf.subjectLabel,
          wf.caseLabel,
          wf.description ?? "",
        ),
      );
      const nextStages = st.map((s: ApiStage) => ({
        _clientId: s.id,
        id: s.id,
        name: s.name,
        tone: s.tone,
        position: s.position,
      }));
      setStages(nextStages);
      setBaseStages(snapStages(nextStages));
      const nextFields = [...fl]
        .sort((a, b) => a.order - b.order)
        .map((f) => ({
          ...f,
          _clientId: f.field_key,
          keyLocked: true,
        }));
      setFields(nextFields);
      setBaseFields(snapFields(nextFields));
      const nextReqs = rq.map((r: ApiRequirement) => ({
        _clientId: r.id,
        id: r.id,
        key: r.key,
        keyLocked: true,
        label: r.label,
        description: r.description ?? "",
        required: r.required,
        maxFiles: r.maxFiles,
        reusable: r.reusable,
        validityDays: r.validityDays != null ? String(r.validityDays) : "",
        conditionField: r.condition?.field ?? "",
        conditionEquals:
          r.condition?.equals !== undefined
            ? String(r.condition.equals)
            : r.condition?.in?.join(", ") ?? "",
        position: r.position,
      }));
      setReqs(nextReqs);
      setBaseReqs(snapRequirements(nextReqs));
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't load this workflow.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const identityDirty =
    snapIdentity(name, subjectLabel, caseLabel, description) !== baseIdentity;
  const stagesDirty = snapStages(stages) !== baseStages;
  const fieldsDirty = snapFields(fields) !== baseFields;
  const reqsDirty = snapRequirements(reqs) !== baseReqs;

  async function saveIdentity() {
    setBusy("identity");
    setNotice(null);
    setError(null);
    try {
      const updated = await updateWorkflow(slug, {
        name: name.trim(),
        subjectLabel: subjectLabel.trim(),
        caseLabel: caseLabel.trim(),
        description: description.trim() || null,
      });
      setWorkflow((w) => (w ? { ...w, ...updated } : w));
      setName(updated.name);
      setSubjectLabel(updated.subjectLabel);
      setCaseLabel(updated.caseLabel);
      setDescription(updated.description ?? "");
      setBaseIdentity(
        snapIdentity(
          updated.name,
          updated.subjectLabel,
          updated.caseLabel,
          updated.description ?? "",
        ),
      );
      setNotice("Identity saved.");
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't save identity.");
    } finally {
      setBusy(null);
    }
  }

  async function saveStages() {
    setBusy("stages");
    setNotice(null);
    setError(null);
    try {
      const ordered = stages.map((s, i) => ({
        id: s.id,
        name: s.name.trim(),
        tone: s.tone,
        position: i,
      }));
      const next = await putStages(slug, ordered);
      const nextStages = next.map((s) => ({
        _clientId: s.id,
        id: s.id,
        name: s.name,
        tone: s.tone,
        position: s.position,
      }));
      setStages(nextStages);
      setBaseStages(snapStages(nextStages));
      setNotice("Stages saved.");
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't save stages.");
    } finally {
      setBusy(null);
    }
  }

  async function saveFields() {
    setBusy("fields");
    setNotice(null);
    setError(null);
    try {
      const payload: ApiFieldDef[] = fields.map((f, i) => ({
        field_key: f.field_key.trim(),
        label: f.label.trim(),
        field_type: f.field_type,
        input_type: f.input_type,
        required: f.required,
        options: f.input_type === "dropdown" ? f.options ?? [] : undefined,
        placeholder: f.placeholder,
        order: i,
        show_in_table: f.show_in_table,
        format: f.format,
      }));
      const next = await putFields(slug, payload);
      const nextFields = next.map((f) => ({
        ...f,
        _clientId: f.field_key,
        keyLocked: true,
      }));
      setFields(nextFields);
      setBaseFields(snapFields(nextFields));
      setNotice("Fields saved.");
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't save fields.");
    } finally {
      setBusy(null);
    }
  }

  async function saveRequirements() {
    setBusy("requirements");
    setNotice(null);
    setError(null);
    try {
      const payload = reqs.map((r, i) => {
        let condition: ApiRequirement["condition"] = null;
        if (r.conditionField.trim() && r.conditionEquals.trim()) {
          const raw = r.conditionEquals.trim();
          if (raw.includes(",")) {
            condition = {
              field: r.conditionField.trim(),
              in: raw.split(",").map((x) => x.trim()).filter(Boolean),
            };
          } else {
            condition = {
              field: r.conditionField.trim(),
              equals: raw,
            };
          }
        }
        return {
          id: r.id,
          key: r.key.trim(),
          label: r.label.trim(),
          description: r.description.trim() || null,
          required: r.required,
          accepts: [],
          maxFiles: r.maxFiles,
          reusable: r.reusable,
          validityDays: r.validityDays.trim()
            ? Number(r.validityDays.trim())
            : null,
          condition,
          position: i,
        };
      });
      const next = await putRequirements(slug, payload);
      const nextReqs = next.map((r) => ({
        _clientId: r.id,
        id: r.id,
        key: r.key,
        keyLocked: true,
        label: r.label,
        description: r.description ?? "",
        required: r.required,
        maxFiles: r.maxFiles,
        reusable: r.reusable,
        validityDays: r.validityDays != null ? String(r.validityDays) : "",
        conditionField: r.condition?.field ?? "",
        conditionEquals:
          r.condition?.equals !== undefined
            ? String(r.condition.equals)
            : r.condition?.in?.join(", ") ?? "",
        position: r.position,
      }));
      setReqs(nextReqs);
      setBaseReqs(snapRequirements(nextReqs));
      setNotice("Checklist saved.");
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't save checklist.");
    } finally {
      setBusy(null);
    }
  }

  function moveStage(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= stages.length) return;
    setStages((prev) => {
      const copy = [...prev];
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  }

  function moveField(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= fields.length) return;
    setFields((prev) => {
      const copy = [...prev];
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  }

  function moveReq(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= reqs.length) return;
    setReqs((prev) => {
      const copy = [...prev];
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  }

  if (loading) {
    return (
      <div className="flex w-full flex-col gap-5">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex w-full flex-col gap-5">
        <ErrorBanner>{error ?? "Workflow not found."}</ErrorBanner>
        <Link href="/workflows" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
          Back to workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="space-y-1">
        <Link
          href="/workflows"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="arrow_back" size={16} />
          Workflows
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {workflow.name}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Slug <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{workflow.slug}</code>{" "}
          is permanent.
        </p>
      </div>

      <ErrorBanner>{error}</ErrorBanner>
      <NoticeBanner>{notice}</NoticeBanner>

      {!canEdit ? (
        <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Icon name="info" size={15} className="mt-0.5 shrink-0" />
          <span>Read-only. Ask an owner or admin to change this workflow.</span>
        </div>
      ) : null}

      {/* Identity */}
      <Card className="gap-0 overflow-hidden py-0">
        <SectionHeader
          title="Identity"
          hint="What this process is called. Subject is the person (Borrower / Student); each run is a Case."
          action={
            canEdit ? (
              <Button
                size="sm"
                disabled={busy === "identity" || !identityDirty}
                onClick={() => void saveIdentity()}
              >
                {busy === "identity" ? "Saving…" : "Save"}
              </Button>
            ) : null
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              maxLength={120}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Subject label</span>
            <Input
              value={subjectLabel}
              onChange={(e) => setSubjectLabel(e.target.value)}
              disabled={!canEdit}
              maxLength={64}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Case label</span>
            <Input
              value={caseLabel}
              onChange={(e) => setCaseLabel(e.target.value)}
              disabled={!canEdit}
              maxLength={64}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
              maxLength={500}
              rows={2}
              className={cn(FIELD_CLASS, "h-auto! py-2")}
            />
          </label>
        </div>
      </Card>

      {/* Stages */}
      <Card className="gap-0 overflow-hidden py-0">
        <SectionHeader
          title="Stages"
          hint="Board columns, in order. Remove a stage only after moving its open cases."
          action={
            canEdit ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setStages((prev) => [
                      ...prev,
                      {
                        _clientId: newId(),
                        name: "New stage",
                        tone: "muted",
                        position: prev.length,
                      },
                    ])
                  }
                >
                  Add stage
                </Button>
                <Button
                  size="sm"
                  disabled={busy === "stages" || !stagesDirty}
                  onClick={() => void saveStages()}
                >
                  {busy === "stages" ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : null
          }
        />
        <div className="divide-y">
          {stages.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No stages yet.</p>
          ) : (
            stages.map((s, i) => (
              <div
                key={s._clientId}
                className="flex flex-wrap items-end gap-2 p-4"
              >
                <label className="min-w-[10rem] flex-1 text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    Name
                  </span>
                  <Input
                    value={s.name}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setStages((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="w-40 text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    Tone
                  </span>
                  <TonePicker
                    value={s.tone}
                    disabled={!canEdit}
                    onChange={(tone) =>
                      setStages((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, tone } : x,
                        ),
                      )
                    }
                  />
                </label>
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => moveStage(i, -1)}
                      aria-label="Move up"
                    >
                      <Icon name="arrow_upward" size={16} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === stages.length - 1}
                      onClick={() => moveStage(i, 1)}
                      aria-label="Move down"
                    >
                      <Icon name="arrow_downward" size={16} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        setStages((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      aria-label="Remove stage"
                    >
                      <Icon name="delete" size={16} />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Fields */}
      <Card className="gap-0 overflow-hidden py-0">
        <SectionHeader
          title="Fields"
          hint="Domain values collected on each case. Keys are sticky after save - renaming a key does not move existing case data."
          action={
            canEdit ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFields((prev) => [
                      ...prev,
                      {
                        _clientId: newId(),
                        field_key: "",
                        label: "",
                        field_type: "string",
                        input_type: "text",
                        required: false,
                        order: prev.length,
                        show_in_table: false,
                        keyLocked: false,
                      },
                    ])
                  }
                >
                  Add field
                </Button>
                <Button
                  size="sm"
                  disabled={busy === "fields" || !fieldsDirty}
                  onClick={() => void saveFields()}
                >
                  {busy === "fields" ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : null
          }
        />
        <div className="divide-y">
          {fields.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No custom fields - only subject name and contact details.
            </p>
          ) : (
            fields.map((f, i) => (
              <div key={f._clientId} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[8rem] flex-1 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Label
                    </span>
                    <Input
                      value={f.label}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const label = e.target.value;
                        setFields((prev) =>
                          prev.map((x, idx) => {
                            if (idx !== i) return x;
                            if (x.keyLocked) return { ...x, label };
                            return {
                              ...x,
                              label,
                              field_key: slugifyKey(label) || x.field_key,
                            };
                          }),
                        );
                      }}
                    />
                  </label>
                  <label className="min-w-[8rem] flex-1 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Key
                    </span>
                    <Input
                      value={f.field_key}
                      disabled={!canEdit || f.keyLocked}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  field_key: e.target.value
                                    .toLowerCase()
                                    .replace(/[^a-z0-9_]/g, ""),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="w-32 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Input
                    </span>
                    <SelectMenu
                      value={f.input_type}
                      disabled={!canEdit}
                      options={[
                        { value: "text", label: "text" },
                        { value: "textarea", label: "textarea" },
                        { value: "number", label: "number" },
                        { value: "dropdown", label: "dropdown" },
                      ]}
                      onChange={(next) => {
                        const input_type = next as ApiFieldDef["input_type"];
                        setFields((prev) =>
                          prev.map((x, idx) => {
                            if (idx !== i) return x;
                            const field_type =
                              input_type === "number"
                                ? "integer"
                                : input_type === "dropdown"
                                  ? "enum"
                                  : "string";
                            return { ...x, input_type, field_type };
                          }),
                        );
                      }}
                    />
                  </label>
                  {canEdit ? (
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={i === 0}
                        onClick={() => moveField(i, -1)}
                      >
                        <Icon name="arrow_upward" size={16} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={i === fields.length - 1}
                        onClick={() => moveField(i, 1)}
                      >
                        <Icon name="arrow_downward" size={16} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          setFields((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        <Icon name="delete" size={16} />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={f.required}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, required: e.target.checked }
                              : x,
                          ),
                        )
                      }
                    />
                    Required
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!f.show_in_table}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, show_in_table: e.target.checked }
                              : x,
                          ),
                        )
                      }
                    />
                    Show in cases table
                  </label>
                  {f.input_type === "dropdown" ? (
                    <label className="flex min-w-[12rem] flex-1 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Options
                      </span>
                      <Input
                        value={(f.options ?? []).join(", ")}
                        disabled={!canEdit}
                        placeholder="A, B, C"
                        onChange={(e) =>
                          setFields((prev) =>
                            prev.map((x, idx) =>
                              idx === i
                                ? {
                                    ...x,
                                    options: e.target.value
                                      .split(",")
                                      .map((o) => o.trim())
                                      .filter(Boolean),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                  ) : null}
                  {f.keyLocked ? (
                    <Badge variant="outline" className="font-normal">
                      key locked
                    </Badge>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Checklist */}
      <Card className="gap-0 overflow-hidden py-0">
        <SectionHeader
          title="Document checklist"
          hint="What must be collected. Keys lock after save so the classifier keeps matching."
          action={
            canEdit ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setReqs((prev) => [
                      ...prev,
                      {
                        _clientId: newId(),
                        key: "",
                        keyLocked: false,
                        label: "",
                        description: "",
                        required: true,
                        maxFiles: 1,
                        reusable: false,
                        validityDays: "",
                        conditionField: "",
                        conditionEquals: "",
                        position: prev.length,
                      },
                    ])
                  }
                >
                  Add item
                </Button>
                <Button
                  size="sm"
                  disabled={busy === "requirements" || !reqsDirty}
                  onClick={() => void saveRequirements()}
                >
                  {busy === "requirements" ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : null
          }
        />
        <div className="divide-y">
          {reqs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No checklist items yet.
            </p>
          ) : (
            reqs.map((r, i) => (
              <div key={r._clientId} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[8rem] flex-1 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Label
                    </span>
                    <Input
                      value={r.label}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const label = e.target.value;
                        setReqs((prev) =>
                          prev.map((x, idx) => {
                            if (idx !== i) return x;
                            if (x.keyLocked) return { ...x, label };
                            return {
                              ...x,
                              label,
                              key: slugifyKey(label) || x.key,
                            };
                          }),
                        );
                      }}
                    />
                  </label>
                  <label className="min-w-[8rem] flex-1 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Key
                    </span>
                    <Input
                      value={r.key}
                      disabled={!canEdit || r.keyLocked}
                      onChange={(e) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  key: e.target.value
                                    .toLowerCase()
                                    .replace(/[^a-z0-9_]/g, ""),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="w-24 text-sm">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Max files
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={r.maxFiles}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  maxFiles: Math.max(
                                    1,
                                    Number(e.target.value) || 1,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  {canEdit ? (
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={i === 0}
                        onClick={() => moveReq(i, -1)}
                      >
                        <Icon name="arrow_upward" size={16} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={i === reqs.length - 1}
                        onClick={() => moveReq(i, 1)}
                      >
                        <Icon name="arrow_downward" size={16} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          setReqs((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        <Icon name="delete" size={16} />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Description
                  </span>
                  <Input
                    value={r.description}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setReqs((prev) =>
                        prev.map((x, idx) =>
                          idx === i
                            ? { ...x, description: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.required}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, required: e.target.checked }
                              : x,
                          ),
                        )
                      }
                    />
                    Required
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.reusable}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, reusable: e.target.checked }
                              : x,
                          ),
                        )
                      }
                    />
                    Reusable across cases
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Validity (days)
                    </span>
                    <Input
                      className="w-24"
                      value={r.validityDays}
                      disabled={!canEdit}
                      placeholder="∞"
                      onChange={(e) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  validityDays: e.target.value.replace(
                                    /[^0-9]/g,
                                    "",
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Only when field
                    </span>
                    <SelectMenu
                      value={r.conditionField}
                      disabled={!canEdit}
                      options={[
                        { value: "", label: "Always" },
                        ...fields.map((f) => ({
                          value: f.field_key,
                          label: f.label || f.field_key,
                        })),
                      ]}
                      onChange={(next) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, conditionField: next }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      equals / in (comma-separated)
                    </span>
                    <Input
                      value={r.conditionEquals}
                      disabled={!canEdit || !r.conditionField}
                      onChange={(e) =>
                        setReqs((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, conditionEquals: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
