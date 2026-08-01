"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listCases,
  createCase,
  listStages,
  listWorkflows,
  updateCaseStage,
  AuthRequiredError,
  type ApiCase,
  type ApiStage,
  type ApiWorkflow,
  type ApiFieldDef,
  type CreateCaseInput,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Cases — the table and board over one workflow's cases.
 *
 * Both surfaces are workflow-driven, not lending-shaped: board columns come
 * from the workflow's own stages, and the table's domain columns from the
 * fields it flags with show_in_table. Nothing here names an industry, so the
 * same screen serves a lender, a college or a CA firm.
 *
 * Still lending-shaped: the create-case dialog's fields (PAN, entity type,
 * loan amount…), which are hardcoded rather than rendered from the field
 * config. Tracked — it is the last surface in this class.
 * ------------------------------------------------------------------ */

/** localStorage key remembering which workflow the Cases screen is showing. */
const WORKFLOW_STORAGE_KEY = "docket_workflow_slug";

/*
 * Two ways to look at the same cases, not six sections.
 *
 * This was All Cases / Action / Board / List / Dashboard / Settings, of which
 * Board and the table were real and four rendered a placeholder card. Three of
 * those four have since moved somewhere truthful in the navigation — Action is
 * "Needs attention", Dashboard is "Overview", and workflow Settings belongs
 * under Setup, where it no longer sits confusingly beside the app's own
 * Settings. "List" was a second table.
 *
 * What is left is a display toggle, so it is rendered as one: a tab strip
 * implies sections with different content, and these show identical data
 * arranged two ways.
 */
const VIEWS = ["Table", "Board"] as const;
type View = (typeof VIEWS)[number];

/**
 * A stage is whatever the workflow says it is — a free string, never a fixed
 * union. This used to be a hardcoded list of the 12 Business Loan stages, which
 * broke every other industry twice over: the Board rendered lending columns a
 * college does not have, and any case whose stage was not in the list collapsed
 * to "Pending", so admissions cases vanished from the board entirely.
 */
type Stage = string;

/**
 * Styling comes from the stage's `tone` (stored per stage, returned by the API),
 * not from its name. A tenant can name a stage anything; the tone is the
 * contract. Unknown tones fall back to neutral rather than rendering unstyled.
 */
const TONE_CLASS: Record<string, string> = {
  muted: "border-border bg-muted text-muted-foreground",
  teal: "border-primary/20 bg-primary/10 text-primary",
  primary: "border-primary/20 bg-primary/10 text-primary",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  red: "border-red-200 bg-red-50 text-red-700",
};
const toneClass = (tone: string | null | undefined) =>
  TONE_CLASS[tone ?? ""] ?? TONE_CLASS.muted;

/**
 * How a case arrived. Structural — it names a channel, not an industry — so it
 * stays, unlike the loan-type and entity-type lists that used to sit here:
 * those were one industry's vocabulary hardcoded into a shared screen, and the
 * create dialog now reads its options from the workflow's own field config.
 */
type Source = "Portal" | "Whatsapp" | "Email" | "Referral" | "Website" | "Other";

type Lead = {
  id: string;
  /** Human-readable handle (DKT-7F3K2M) quoted over WhatsApp and email. */
  reference: string;
  name: string;
  company: string;
  source: Source;
  stage: Stage;
  /** The stage's tone, for styling. See toneClass(). */
  stageTone: string | null;
  owner: string;
  activity: string;
  /**
   * The case's domain values, exactly as stored. Which of these become columns
   * is the workflow's call (FieldDef.show_in_table) — this screen no longer
   * knows what a "loan amount" is.
   */
  data: Record<string, unknown> | null;
};

// ---- API (ApiCase) -> UI (Lead) mapping --------------------------------------
// The API returns contactName/contactCompany/stageName + a UUID id; the UI view
// model uses name/company/stage. Enum-ish fields arrive as nullable strings, so
// we clamp them to the UI unions with safe defaults. Owner isn't joined yet
// (leads have no owner name) -> "Unassigned"; activity is derived from updatedAt.

/**
 * The stage as the workflow named it. No clamping to a known list: a case whose
 * stage is unrecognised is not "Pending", it is that stage — pretending
 * otherwise is what hid every non-lending case from the board.
 */
function toStage(name: string | null): Stage {
  return name?.trim() || "—";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Read one domain value out of the case's `data` bag. */
function str(data: Record<string, unknown> | null, key: string): string | undefined {
  const v = data?.[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

// Domain fields (loan type, amount, entity type…) are not columns here — they
// live in `data`, keyed as this workflow's field config defines them, and the
// table renders whichever the workflow flags with show_in_table. That is what
// lets the same table serve a lender, a college or a CA firm.
function toLead(a: ApiCase): Lead {
  return {
    id: a.id,
    reference: a.reference,
    name: a.subjectName ?? "—",
    company: a.subjectOrganisation ?? "—",
    source: (a.source ?? str(a.data, "source") ?? "Other") as Source,
    stage: toStage(a.stageName),
    stageTone: a.stageTone,
    owner: "Unassigned",
    activity: relativeTime(a.updatedAt),
    data: a.data,
  };
}

/**
 * Render one domain value for a column, per its field definition. Integers with
 * format "inr" get Indian currency; everything else is shown as text. A missing
 * value is an em dash, never "0" or "undefined".
 */
function cellValue(data: Record<string, unknown> | null, f: ApiFieldDef): string {
  const raw = data?.[f.field_key];
  if (raw === null || raw === undefined || raw === "") return "—";
  if (f.field_type === "integer") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return "—";
    return f.format === "inr" ? inr(n) : String(n);
  }
  return String(raw);
}

/** The domain columns this workflow wants, capped so the table stays readable. */
const MAX_DOMAIN_COLUMNS = 3;
function tableFields(workflow: ApiWorkflow | null): ApiFieldDef[] {
  return (workflow?.fields ?? [])
    .filter((f) => f.show_in_table)
    .slice(0, MAX_DOMAIN_COLUMNS);
}

/**
 * Plural of a workflow's own noun — "Application" -> "Applications",
 * "Enquiry" -> "Enquiries".
 *
 * The vocabulary is tenant-authored, so copy cannot hard-code "cases" and
 * cannot naively append "s" either: a workspace collecting Enquiries would read
 * "Enquirys" on every empty state. These rules cover ordinary English nouns; a
 * workflow whose plural is irregular ("Person") needs a plural field of its own
 * on the workflow, which is the honest fix if a tenant ever asks for one.
 */
function plural(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + "es";
  return label + "s";
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

/* ------------------------------- Workflow selector ------------------------------- */

/**
 * Which of the tenant's workflows this screen is showing. Real, not cosmetic:
 * the selection drives which cases, stages and vocabulary load. Hidden when a
 * tenant runs a single workflow — a picker with one option is noise. (The old
 * mock listed a hardcoded name and a dead "Create New Workflow" button; the
 * builder belongs to tenant onboarding, not this screen.)
 */
function WorkflowSelect({
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
  const selected = workflows.find((w) => w.slug === selectedSlug) ?? workflows[0];
  return (
    <div className="relative">
      <Button variant="outline" className="gap-2" onClick={() => setOpen((o) => !o)}>
        {selected.name}
        <Icon name="expand_more" size={16} className="text-muted-foreground" />
      </Button>
      {open ? (
        <>
          <button
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            {workflows.map((w) => (
              <button
                key={w.slug}
                onClick={() => {
                  setOpen(false);
                  if (w.slug !== selected.slug) onSelect(w.slug);
                }}
                className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-sm hover:bg-accent"
              >
                {w.name}
                {selected.slug === w.slug ? (
                  <Icon name="check" size={16} className="text-primary" />
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------- Create-lead slide-over ------------------------------- */

const FIELD_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

/**
 * One field, rendered from the workflow's own field config.
 *
 * The dialog used to hardcode PAN / entity type / loan amount — one industry's
 * vocabulary baked into a screen meant to serve a college and a CA firm too.
 * Everything domain-specific now comes from FieldDef, which the API already
 * returned and this screen already used for its table columns.
 */
function DynamicField({
  field,
  value,
  error,
  onChange,
}: {
  field: ApiFieldDef;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={field.label} error={error} required={field.required}>
      {field.input_type === "dropdown" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS}>
          {/* An optional dropdown needs an empty choice, or its first option
              silently becomes an answer nobody gave. */}
          {!field.required ? <option value="">—</option> : null}
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.input_type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={field.placeholder}
          className={`${FIELD_CLASS} h-auto resize-none py-2`}
        />
      ) : (
        <Input
          type={field.input_type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}
    </Field>
  );
}

/**
 * Validate one value against its FieldDef. Returns a message, or null.
 *
 * `minimum`/`maximum` mean VALUE for integers and LENGTH for strings — that is
 * how the config uses them (PAN carries minimum 10, maximum 10 alongside its
 * regex).
 */
function validateField(field: ApiFieldDef, raw: string): string | null {
  const value = raw.trim();
  if (!value) return field.required ? `${field.label} is required.` : null;

  const v = field.validation ?? {};
  const num = (x: unknown) => {
    if (x === undefined || x === null || x === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  if (typeof v.regex === "string" && v.regex) {
    try {
      if (!new RegExp(v.regex).test(value)) return `${field.label} is not in the expected format.`;
    } catch {
      // A malformed regex in config must never block data entry.
    }
  }

  const min = num(v.minimum);
  const max = num(v.maximum);
  if (field.field_type === "integer") {
    const n = Number(value);
    if (!Number.isFinite(n)) return `${field.label} must be a number.`;
    if (min !== null && n < min) return `${field.label} must be at least ${min}.`;
    if (max !== null && n > max) return `${field.label} must be at most ${max}.`;
  } else {
    if (min !== null && value.length < min) {
      return `${field.label} must be at least ${min} characters.`;
    }
    if (max !== null && value.length > max) {
      return `${field.label} must be at most ${max} characters.`;
    }
  }
  return null;
}

function CreateLeadDialog({
  open,
  onOpenChange,
  onCreate,
  workflows,
  selectedSlug,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (input: CreateCaseInput) => Promise<void>;
  /** Every workflow this tenant runs — the form rebuilds itself per choice. */
  workflows: ApiWorkflow[];
  /** The workflow the Cases screen is showing; the dialog opens on it. */
  selectedSlug: string | null;
}) {
  const [slug, setSlug] = React.useState<string>("");
  const [name, setName] = React.useState("");
  const [organisation, setOrganisation] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const workflow = workflows.find((w) => w.slug === (slug || selectedSlug)) ?? workflows[0] ?? null;
  const subjectLabel = workflow?.subjectLabel ?? "Contact";
  const caseLabel = workflow?.caseLabel ?? "Case";
  const fields = React.useMemo(
    () => [...(workflow?.fields ?? [])].sort((a, b) => a.order - b.order),
    [workflow],
  );

  function reset() {
    setSlug("");
    setName("");
    setOrganisation("");
    setEmail("");
    setPhone("");
    setValues({});
    setErrors({});
    setSubmitError(null);
    setSubmitting(false);
  }

  // Reset on ANY close (✕ / Escape / backdrop / Cancel), so re-opening starts clean.
  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  /** Switching workflow changes which fields exist — old answers cannot carry over. */
  function chooseWorkflow(next: string) {
    setSlug(next);
    setValues({});
    setErrors({});
  }

  async function submit() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.__name = `${subjectLabel} name is required.`;
    // Loose on purpose: the API validates properly, and a create blocked by a
    // client-side email rule is worse than one the server explains.
    if (email.trim() && !email.includes("@")) errs.__email = "That does not look like an email.";
    for (const f of fields) {
      const msg = validateField(f, values[f.field_key] ?? "");
      if (msg) errs[f.field_key] = msg;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    // Only answered fields travel; integers go as numbers so the API and the
    // case Overview format them as numbers.
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (values[f.field_key] ?? "").trim();
      if (!raw) continue;
      data[f.field_key] = f.field_type === "integer" ? Number(raw) : raw;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onCreate({
        name: name.trim(),
        organisation: organisation.trim() || undefined,
        // The routing keys. Until now this dialog collected NEITHER, so a case
        // created here could never be matched to an inbound email or WhatsApp
        // message — the subject's documents had nowhere to land.
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        // `source` is both a case column and (for this workflow) a field. The
        // column is what the board and Overview read, so mirror it up.
        source: typeof data.source === "string" ? data.source : undefined,
        workflow: workflow?.slug,
        data,
      });
      handleOpenChange(false); // resets + closes on success
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Couldn't create the case. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 p-0">
        <DialogHeader className="border-b pr-10">
          <DialogTitle>New {caseLabel.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {workflow ? `${workflow.name} workflow` : "No workflow configured"} · the document
            checklist is built when it is created.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* With one workflow there is nothing to choose — a picker would be
              noise. It appears the moment a tenant runs two. */}
          {workflows.length > 1 ? (
            <FormSection title="Workflow">
              <Field label="What is this for?">
                <select
                  value={workflow?.slug ?? ""}
                  onChange={(e) => chooseWorkflow(e.target.value)}
                  className={FIELD_CLASS}
                >
                  {workflows.map((w) => (
                    <option key={w.slug} value={w.slug}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            </FormSection>
          ) : null}

          <FormSection title={subjectLabel}>
            <Field label="Full name" error={errors.__name} required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ramesh Kumar"
              />
            </Field>
            <Field label="Organisation">
              <Input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Business, college or firm (optional)"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" error={errors.__email}>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Email and phone are how documents this {subjectLabel.toLowerCase()} sends are matched
              back to this {caseLabel.toLowerCase()}.
            </p>
          </FormSection>

          {/* The checklist is deliberately NOT previewed here. Which documents
              apply depends on conditions the API evaluates against the case's
              own data (an LLP and a proprietorship get different lists), and
              re-implementing that rule in the browser would give us two answers
              to the same question — with the WhatsApp and voice bots reading the
              server's. The real list appears on the case as soon as it exists. */}
          <div className="mb-5 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Icon name="fact_check" size={15} className="text-primary" />
              {/* One interpolation, not a sentence split across lines: JSX ate
                  the newline between the expression and the text after it,
                  which rendered "applicationis created". */}
              <span>
                {`The document checklist is built from these answers when the ${caseLabel.toLowerCase()} is created — you’ll land on it next.`}
              </span>
            </div>
          </div>

          {fields.length > 0 ? (
            <FormSection title="Details">
              {fields.map((f) => (
                <DynamicField
                  key={f.field_key}
                  field={f}
                  value={values[f.field_key] ?? ""}
                  error={errors[f.field_key]}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.field_key]: v }))}
                />
              ))}
            </FormSection>
          ) : null}
        </div>

        {submitError ? (
          <div className="flex items-center gap-1.5 border-t bg-red-50 px-4 py-2 text-sm text-red-600">
            <Icon name="error" size={15} /> {submitError}
          </div>
        ) : null}

        <DialogFooter className="flex-row justify-end gap-2 border-t">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !workflow} className="gap-1.5">
            {submitting ? (
              <>
                <Icon name="progress_activity" size={16} className="animate-spin" /> Creating…
              </>
            ) : (
              <>
                <Icon name="add" size={16} /> Create {caseLabel.toLowerCase()}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- All Cases (table) ------------------------------- */

function AllCasesView({
  leads,
  onRefresh,
  subjectLabel,
  caseLabel,
  fields,
}: {
  leads: Lead[];
  onRefresh: () => void;
  /** What this workflow calls the party documents come from. Never hardcoded. */
  subjectLabel: string;
  /** What this workflow calls one run of itself: Application, Admission… */
  caseLabel: string;
  /** Domain columns this workflow declares (show_in_table), already capped. */
  fields: ApiFieldDef[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  // Seed the filter from ?q= (set by the header search) and re-seed whenever it
  // changes — searching again from the header while already on /leads doesn't
  // remount this component, so the filter would otherwise go stale.
  //
  // Adjusted during render rather than in an effect: React re-runs the
  // component immediately without committing the stale pass, whereas an effect
  // would paint the previous filter first and then correct it — a visible flash
  // and a wasted render. Typing still updates `query` freely; only a *change*
  // in ?q= re-seeds it. See react.dev "You Might Not Need an Effect".
  const [query, setQuery] = React.useState(urlQuery);
  const [seededFrom, setSeededFrom] = React.useState(urlQuery);
  if (urlQuery !== seededFrom) {
    setSeededFrom(urlQuery);
    setQuery(urlQuery);
  }
  const filtered = leads.filter((l) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${l.name} ${l.company} ${l.reference}`.toLowerCase().includes(q);
  });

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={18} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${plural(caseLabel).toLowerCase()} by name, company or reference…`}
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Icon name="swap_vert" size={16} /> Updated At
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Icon name="download" size={16} /> Download
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Icon name="filter_list" size={16} /> Filters
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh}>
          <Icon name="refresh" size={16} /> Refresh
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{subjectLabel}</TableHead>
              {fields.map((f) => (
                <TableHead key={f.field_key}>{f.label}</TableHead>
              ))}
              <TableHead>Source</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5 + fields.length} className="py-12 text-center">
                  <div className="text-sm font-medium">
                    No {plural(caseLabel).toLowerCase()} match your search
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query.trim()
                      ? `Nothing found for “${query.trim()}”. Try a name, company or reference.`
                      : `There are no ${plural(caseLabel).toLowerCase()} in this workflow yet.`}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((l) => (
              <TableRow
                key={l.id}
                // The row is the link to the case's checklist. role/tabIndex and
                // the Enter handler keep it reachable without a mouse — a plain
                // onClick on a <tr> is invisible to keyboard and screen readers.
                role="link"
                tabIndex={0}
                aria-label={`Open case ${l.reference}`}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => router.push(`/cases/${l.id}`)}
                onKeyDown={(e) => {
                  // Enter only. role="link" activates on Enter; Space is the
                  // page-scroll key and hijacking it breaks keyboard scrolling.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    router.push(`/cases/${l.id}`);
                  }
                }}
              >
                <TableCell className="pl-4">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{l.company} · {l.reference}</div>
                </TableCell>
                {fields.map((f) => (
                  <TableCell
                    key={f.field_key}
                    className={
                      f.field_type === "integer"
                        ? "whitespace-nowrap tabular-nums"
                        : "whitespace-nowrap text-muted-foreground"
                    }
                  >
                    {cellValue(l.data, f)}
                  </TableCell>
                ))}
                <TableCell>
                  <Badge variant="outline" className="border-border bg-muted font-normal text-muted-foreground">
                    {l.source}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <Avatar className="size-6">
                      <AvatarFallback className="bg-secondary text-[10px]">{initials(l.owner)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{l.owner}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`${toneClass(l.stageTone)} whitespace-nowrap`}>{l.stage}</Badge>
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    aria-label="Case actions"
                    // Both handlers, not just click: the row listens on keydown
                    // too, so Enter on this button would bubble up and navigate
                    // away instead of opening the menu.
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Icon name="more_horiz" size={18} />
                  </Button>
                </TableCell>
              </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t p-3">
        <span className="text-sm text-muted-foreground">
          Showing {filtered.length} of {leads.length}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>Previous</Button>
          <Button variant="outline" size="sm" disabled>Next</Button>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------- Board (kanban over the workflow's stages) ------------------------------- */

function BoardView({
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
  /** Domain columns this workflow declares — the first one labels each card. */
  fields: ApiFieldDef[];
}) {
  const stageIdByName = React.useMemo(() => new Map(stages.map((s) => [s.name, s.id])), [stages]);
  const options: readonly string[] = stages.map((s) => s.name);
  // The card's headline value and its chip: the workflow's own first two
  // table fields. A lender sees the amount and loan type it always did; a
  // college sees the course. Neither is named in this file.
  const [headline, chip] = fields;

  // This board used to iterate a hardcoded list of the 12 Business Loan stages.
  // On any other workflow that rendered columns the tenant does not have AND
  // hid every case, because no case's stage matched a lending name.
  if (stages.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
        <div className="text-sm font-medium">This workflow has no stages yet</div>
        <p className="text-sm text-muted-foreground">
          Add stages to the workflow to use the board.
        </p>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3">
        {stages.map((s) => {
          const stage = s.name;
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div key={s.id} className="flex w-72 shrink-0 flex-col rounded-xl border bg-card">
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
                  items.map((l) => (
                    <div key={l.id} className="rounded-lg border bg-background p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{l.name}</span>
                        {headline ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {cellValue(l.data, headline)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{l.company} · {l.reference}</div>
                      {chip ? (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-[11px] font-normal text-primary">
                            {cellValue(l.data, chip)}
                          </Badge>
                        </div>
                      ) : null}
                      <label className="mt-2 flex items-center gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
                        <Icon name="swap_vert" size={14} className="shrink-0" />
                        <select
                          value={l.stage}
                          disabled={!stages.length}
                          onChange={(e) => {
                            const name = e.target.value as Stage;
                            const id = stageIdByName.get(name);
                            if (id && name !== l.stage) onMoveStage(l.id, id, name);
                          }}
                          aria-label={`Move ${l.name} to another stage`}
                          className="min-w-0 flex-1 rounded-md border bg-background px-1.5 py-1 text-[11px] text-foreground outline-none focus-visible:border-ring disabled:opacity-50"
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

/* ------------------------------- Page ------------------------------- */

export default function CasesPage() {
  const router = useRouter();
  const [view, setView] = React.useState<View>("Table");
  const [leads, setLeads] = React.useState<Lead[]>([]);
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

  // No auth checks here by design: AppChrome won't render this page without a
  // session, and it redirects centrally if the API rejects the token. These
  // handlers only swallow AuthRequiredError so a redirect-in-flight doesn't
  // also flash an error card.

  // Load leads + stages from the live API (apps/api) — tenant-scoped via RLS.
  // Mirrors the schema defaults, so the first paint — before workflows load —
  // shows a neutral word rather than flashing a lending term at a college.
  // Declared here, above the callbacks that read it.
  const subjectLabel = workflow?.subjectLabel ?? "Contact";
  const caseLabel = workflow?.caseLabel ?? "Case";
  // The domain columns this workflow declares. Empty until workflows load, and
  // legitimately empty for a workflow with no field config — both render a table
  // with no domain columns rather than a lending guess.
  const domainFields = React.useMemo(() => tableFields(workflow), [workflow]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Workflows FIRST: once a tenant runs more than one, every other read
      // needs a slug — listCases() with no slug is an error the moment a
      // second workflow exists, which is exactly the trap this used to have.
      const all = await listWorkflows();
      setWorkflows(all);

      // Which workflow to show: the current selection if it still exists,
      // else the persisted choice, else the first. Nothing here guesses a
      // slug — the list is the authority.
      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem(WORKFLOW_STORAGE_KEY) : null;
      const slug =
        (selectedSlug && all.some((w) => w.slug === selectedSlug) && selectedSlug) ||
        (stored && all.some((w) => w.slug === stored) && stored) ||
        all[0]?.slug ||
        null;
      if (slug !== selectedSlug) setSelectedSlug(slug);

      const wf = all.find((w) => w.slug === slug) ?? null;
      setWorkflow(wf);
      const [rows, stageRows] = await Promise.all([
        listCases(slug ?? undefined),
        wf ? listStages(wf.slug) : Promise.resolve([]),
      ]);
      setLeads(rows.map(toLead));
      setStages(stageRows);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Failed to load this workflow.");
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  // Move a lead to another stage — optimistic, with revert + message on failure.
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
    // Fetching on mount is what an effect is for — synchronising with an
    // external system. refresh() sets loading/error, which the rule flags, but
    // on mount those already equal their initial values so React bails out
    // rather than cascading. Removing the warning properly would mean moving to
    // a data library/route loader — a bigger change than this screen needs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Open the create modal when arriving from the Home's "New case" (/cases?new=1),
  // then tidy the URL back to /leads. This must be an effect: it reads
  // window.location (unavailable during SSR, so it can't seed useState without a
  // hydration mismatch) and rewrites the URL — an external system.
  // Mirrors the schema default, so the first paint (before workflows load)
  // shows a neutral word rather than flashing a lending term at a college.

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCreateOpen(true);
      window.history.replaceState(null, "", "/cases");
    }
  }, []);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cases</h1>
          <p className="text-sm text-muted-foreground">
            Every {subjectLabel.toLowerCase()} in the pipeline, and what each{" "}
            {caseLabel.toLowerCase()} still needs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkflowSelect
            workflows={workflows}
            selectedSlug={selectedSlug}
            onSelect={(slug) => {
              window.localStorage.setItem(WORKFLOW_STORAGE_KEY, slug);
              // refresh() depends on selectedSlug, so the effect below re-runs
              // it — one place reloads cases, stages and vocabulary together.
              setSelectedSlug(slug);
            }}
          />
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={18} /> Case
          </Button>
          <Button variant="outline" size="icon" aria-label="More options">
            <Icon name="more_vert" size={18} />
          </Button>
        </div>
      </div>

      {/* Display toggle. role=group with aria-pressed, not a tablist: these
          buttons swap how one set of cases is drawn, they do not switch panels. */}
      <div
        role="group"
        aria-label="Case display"
        className="inline-flex w-fit items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === v
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon name={v === "Table" ? "table_rows" : "view_kanban"} size={16} />
            {v}
          </button>
        ))}
      </div>

      {moveError ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="flex items-center gap-1.5">
            <Icon name="error" size={16} /> {moveError}
          </span>
          <button
            onClick={() => setMoveError(null)}
            aria-label="Dismiss"
            className="text-red-700/70 hover:text-red-700"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}

      {error ? (
        <Card className="flex flex-col items-center gap-3 border-red-200 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Icon name="error" size={22} />
          </div>
          <div>
            <div className="font-medium">
              Couldn&rsquo;t load {plural(caseLabel).toLowerCase()}
            </div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Make sure the API is running (<code>pnpm --filter @docket/api dev</code>).
            </p>
          </div>
          <Button variant="outline" onClick={refresh} className="gap-1.5">
            <Icon name="refresh" size={16} /> Retry
          </Button>
        </Card>
      ) : loading ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Icon name="progress_activity" size={22} className="animate-spin" />
          <span className="text-sm">Loading {plural(caseLabel).toLowerCase()}…</span>
        </Card>
      ) : (
        <>
      {/* Suspense: AllCasesView reads useSearchParams (?q= from the header search). */}
      {view === "Table" ? (
        <React.Suspense>
          <AllCasesView
            leads={leads}
            onRefresh={refresh}
            subjectLabel={subjectLabel}
            caseLabel={caseLabel}
            fields={domainFields}
          />
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
            // The new case belongs to the workflow this screen is showing.
            // Without the slug, POST /cases rejects the moment a tenant runs
            // more than one workflow — the create-dialog sibling of the same
            // bug the picker fixes.
            const created = await createCase({ ...input, workflow: selectedSlug ?? undefined });
            // Straight to the checklist. Creating a case and then hunting for
            // it in the table is the wrong next step — what the case needs is
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
