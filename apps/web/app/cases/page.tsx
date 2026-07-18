"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
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
  type CreateCaseInput,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Schema mirrors the live Gain "Business Loan" workflow (see
 * docs/gain-parity-audit.html): the exact 12 board stages, the real
 * lead fields (loan_type / entity_type / source enums), and the six
 * views. "Portal" is spelled correctly here (Gain's enum has a "Protal"
 * typo). The +Lead modal creates leads into the pipeline at Pending.
 * ------------------------------------------------------------------ */

const WORKFLOWS = ["Business Loan"] as const;

const VIEWS = [
  "All Cases",
  "Action",
  "Board",
  "List",
  "Dashboard",
  "Settings",
] as const;
type View = (typeof VIEWS)[number];

const STAGES = [
  "Pending",
  "Proprietorship Documents Collection",
  "Partnership Document Collection",
  "PVT LTD Document Collection",
  "Follow up",
  "Auto Follow-Up",
  "Human Escalated",
  "Not Interested",
  "Not Picked",
  "No Answer",
  "Completed",
  "Missing PanCard",
] as const;
type Stage = (typeof STAGES)[number];

const STAGE_TONE: Record<Stage, string> = {
  Pending: "border-border bg-muted text-muted-foreground",
  "Proprietorship Documents Collection": "border-primary/20 bg-primary/10 text-primary",
  "Partnership Document Collection": "border-primary/20 bg-primary/10 text-primary",
  "PVT LTD Document Collection": "border-primary/20 bg-primary/10 text-primary",
  "Follow up": "border-amber-200 bg-amber-50 text-amber-700",
  "Auto Follow-Up": "border-amber-200 bg-amber-50 text-amber-700",
  "Human Escalated": "border-orange-200 bg-orange-50 text-orange-700",
  "Not Interested": "border-border bg-muted text-muted-foreground",
  "Not Picked": "border-border bg-muted text-muted-foreground",
  "No Answer": "border-border bg-muted text-muted-foreground",
  Completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Missing PanCard": "border-red-200 bg-red-50 text-red-700",
};

type LoanType = "SME Term Loan" | "LAP" | "Working Capital" | "Top-up";
type EntityType =
  | "Proprietorship"
  | "Partnership"
  | "Private Limited"
  | "Public Limited"
  | "LLP";
type Source = "Portal" | "Whatsapp" | "Email" | "Referral" | "Website" | "Other";

const LOAN_TYPES: LoanType[] = ["SME Term Loan", "LAP", "Working Capital", "Top-up"];
const ENTITY_TYPES: EntityType[] = [
  "Proprietorship",
  "Partnership",
  "Private Limited",
  "Public Limited",
  "LLP",
];
const SOURCES: Source[] = ["Portal", "Whatsapp", "Email", "Referral", "Website", "Other"];

type Lead = {
  id: string;
  /** Human-readable handle (DKT-7F3K2M) quoted over WhatsApp and email. */
  reference: string;
  name: string;
  company: string;
  loanType: LoanType;
  entityType: EntityType;
  amount: number;
  source: Source;
  monthlyTurnover: number;
  stage: Stage;
  owner: string;
  activity: string;
};

// ---- API (ApiCase) -> UI (Lead) mapping --------------------------------------
// The API returns contactName/contactCompany/stageName + a UUID id; the UI view
// model uses name/company/stage. Enum-ish fields arrive as nullable strings, so
// we clamp them to the UI unions with safe defaults. Owner isn't joined yet
// (leads have no owner name) -> "Unassigned"; activity is derived from updatedAt.

const STAGE_SET = new Set<string>(STAGES);

function toStage(name: string | null): Stage {
  return name && STAGE_SET.has(name) ? (name as Stage) : "Pending";
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
function num(data: Record<string, unknown> | null, key: string): number {
  const v = data?.[key];
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Domain fields (loan type, amount, entity type) are no longer columns — they
// live in `data`, keyed as this workflow's field config defines them. That is
// what lets the same table serve a college or a CA firm. This screen still
// renders the lending shape; making the columns config-driven is a later change.
function toLead(a: ApiCase): Lead {
  return {
    id: a.id,
    reference: a.reference,
    name: a.subjectName ?? "—",
    company: a.subjectOrganisation ?? "—",
    loanType: (str(a.data, "loan_type") ?? "SME Term Loan") as LoanType,
    entityType: (str(a.data, "entity_type") ?? "Proprietorship") as EntityType,
    amount: num(a.data, "loan_amount"),
    source: (a.source ?? str(a.data, "source") ?? "Other") as Source,
    monthlyTurnover: num(a.data, "monthly_turnover"),
    stage: toStage(a.stageName),
    owner: "Unassigned",
    activity: relativeTime(a.updatedAt),
  };
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

// Entity-type-aware document checklist (our guided touch — Gain doesn't preview
// docs on lead creation). Counts reflect India-lender best-practice, cross-checked
// against Gain's blueprints + web research — see
// docs/docket-document-checklist-comparison.html. Several items are multi-document
// (2 yrs ITR, 12 mo statements, per-director/partner KYC), so real files are higher.
const DOC_HINTS: Record<EntityType, string[]> = {
  Proprietorship: [
    "Passport photo",
    "Proprietor PAN",
    "Proprietor Aadhaar",
    "Residence address proof",
    "Office address proof",
    "Business proof (Shop Act / Udyam)",
    "ITR + computation (2 yrs)",
    "Form 3CB/3CD + audited B/S (2 yrs)",
    "Current-A/c statements (12 mo)",
    "GST certificate",
    "GSTR-3B (12 mo)",
    "Udyam / MSME cert",
    "Existing loan details",
    "Property ownership proof",
    "Collateral docs (if secured)",
  ],
  Partnership: [
    "Firm PAN",
    "Partnership deed",
    "Partnership registration cert",
    "All partners' PAN",
    "All partners' Aadhaar",
    "Partners' photos",
    "Managing-partner authority letter",
    "Office address proof",
    "Last-2-yrs financials",
    "ITR (2 yrs)",
    "Bank statements — Current/CC/OD (12 mo)",
    "GST certificate",
    "GSTR-3B (12 mo)",
    "Udyam cert",
    "Property ownership proof",
    "Existing loan details",
    "Collateral docs (if secured)",
  ],
  "Private Limited": [
    "Company PAN",
    "Certificate of Incorporation",
    "MOA",
    "AOA",
    "Board resolution",
    "All directors' PAN",
    "All directors' Aadhaar",
    "Directors' photos",
    "List of directors (DIN)",
    "Shareholding pattern",
    "Office address proof",
    "Company ITR (2 yrs)",
    "Form 3CB + audited financials (2 yrs)",
    "Current-A/c statements (12 mo)",
    "GST certificate",
    "GSTR-3B (12 mo)",
    "Udyam / MSME cert",
    "Existing loan details",
    "Collateral docs (if secured)",
  ],
  "Public Limited": [
    "Company PAN",
    "Certificate of Incorporation",
    "MOA",
    "AOA",
    "Board resolution",
    "All directors' PAN",
    "All directors' Aadhaar",
    "Directors' photos",
    "List of directors (DIN)",
    "Shareholding pattern",
    "Office address proof",
    "Company ITR (2 yrs)",
    "Form 3CB + audited financials (2 yrs)",
    "Current-A/c statements (12 mo)",
    "GST certificate",
    "GSTR-3B (12 mo)",
    "Udyam / MSME cert",
    "Existing loan details",
    "Collateral docs (if secured)",
    "Annual report / prospectus",
    "Auditor's report + MCA filings",
  ],
  LLP: [
    "LLP PAN",
    "Certificate of Incorporation",
    "LLP Agreement (Form 3)",
    "All designated partners' PAN",
    "All designated partners' Aadhaar",
    "DPIN (designated partners)",
    "DSC (authorized signatory)",
    "Partners' photos",
    "Office address proof",
    "Rent agreement + NOC (if rented)",
    "Last-2-yrs financials",
    "ITR (2 yrs)",
    "Bank statements (12 mo)",
    "GST certificate",
    "GSTR-3B (12 mo)",
    "Udyam cert",
    "Existing loan details",
  ],
};

// Auto-format a PAN as it's typed: uppercase, strip junk, enforce AAAAA9999A structure.
function formatPan(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const wantsLetter = i < 5 || i === 9;
    if (wantsLetter ? /[A-Z]/.test(s[i]) : /[0-9]/.test(s[i])) out += s[i];
    else break;
  }
  return out;
}

/* ------------------------------- Workflow selector ------------------------------- */

function WorkflowSelect() {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string>(WORKFLOWS[0]);
  return (
    <div className="relative">
      <Button variant="outline" className="gap-2" onClick={() => setOpen((o) => !o)}>
        {selected}
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
            {WORKFLOWS.map((w) => (
              <button
                key={w}
                onClick={() => {
                  setSelected(w);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-sm hover:bg-accent"
              >
                {w}
                {selected === w ? <Icon name="check" size={16} className="text-primary" /> : null}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm text-primary hover:bg-accent">
              <Icon name="add" size={16} /> Create New Workflow
            </button>
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

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function CreateLeadDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (input: CreateCaseInput) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [pan, setPan] = React.useState("");
  const [loanType, setLoanType] = React.useState<LoanType>("SME Term Loan");
  const [entityType, setEntityType] = React.useState<EntityType>("Proprietorship");
  const [amount, setAmount] = React.useState("");
  const [turnover, setTurnover] = React.useState("");
  const [source, setSource] = React.useState<Source>("Portal");
  const [funds, setFunds] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  function reset() {
    setName("");
    setCompany("");
    setPan("");
    setLoanType("SME Term Loan");
    setEntityType("Proprietorship");
    setAmount("");
    setTurnover("");
    setSource("Portal");
    setFunds("");
    setErrors({});
    setSubmitError(null);
    setSubmitting(false);
  }

  // Reset on ANY close (✕ / Escape / backdrop / Cancel), so re-opening starts clean.
  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Borrower name is required.";
    if (!company.trim()) errs.company = "Company name is required.";
    const amt = Number(amount);
    if (!amount || Number.isNaN(amt) || amt <= 0) errs.amount = "Enter a valid amount.";
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.trim().toUpperCase()))
      errs.pan = "PAN must look like ABCDE1234F.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onCreate({
        name: name.trim(),
        organisation: company.trim() || undefined,
        source,
        // Keys match this workflow's field config (see business-loan-config.ts).
        data: {
          pan_number: pan.trim() || undefined,
          loan_type: loanType,
          entity_type: entityType,
          loan_amount: amt,
          monthly_turnover: Number(turnover) || undefined,
          funds_needed: funds.trim() || undefined,
        },
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
          <DialogTitle>New case</DialogTitle>
          <DialogDescription>
            Business Loan workflow · lands in Pending, then the AI workforce takes over.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <FormSection title="Borrower">
            <Field label="Full name" error={errors.name} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
            </Field>
            <Field label="Company name" error={errors.company} required>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Kumar Traders" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PAN" error={errors.pan}>
                <Input
                  value={pan}
                  onChange={(e) => setPan(formatPan(e.target.value))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                />
              </Field>
              <Field label="Entity type">
                <SelectField value={entityType} onChange={(v) => setEntityType(v as EntityType)} options={ENTITY_TYPES} />
              </Field>
            </div>
          </FormSection>

          <div className="mb-5 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Icon name="fact_check" size={15} className="text-primary" />
              <span>
                <span className="text-primary">{DOC_HINTS[entityType].length} documents</span> we&rsquo;ll collect for a {entityType}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DOC_HINTS[entityType].map((d) => (
                <span
                  key={d}
                  className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>

          <FormSection title="Loan ask">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loan type">
                <SelectField value={loanType} onChange={(v) => setLoanType(v as LoanType)} options={LOAN_TYPES} />
              </Field>
              <Field label="Loan amount (₹)" error={errors.amount} required>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="4000000" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Monthly turnover (₹)">
                <Input type="number" value={turnover} onChange={(e) => setTurnover(e.target.value)} placeholder="1200000" />
              </Field>
              <Field label="Source">
                <SelectField value={source} onChange={(v) => setSource(v as Source)} options={SOURCES} />
              </Field>
            </div>
            <Field label="Funds needed for">
              <textarea
                value={funds}
                onChange={(e) => setFunds(e.target.value)}
                placeholder="Short note on use of funds…"
                rows={3}
                className={`${FIELD_CLASS} h-auto resize-none py-2`}
              />
            </Field>
          </FormSection>
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
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            {submitting ? (
              <>
                <Icon name="progress_activity" size={16} className="animate-spin" /> Creating…
              </>
            ) : (
              <>
                <Icon name="add" size={16} /> Create case
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Placeholder tabs ------------------------------- */

function Placeholder({ title, blurb, chips }: { title: string; blurb: string; chips?: string[] }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name="construction" size={22} />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{blurb}</p>
      </div>
      {chips ? (
        <div className="flex flex-wrap justify-center gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------- All Cases (table) ------------------------------- */

function AllCasesView({ leads, onRefresh }: { leads: Lead[]; onRefresh: () => void }) {
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
            placeholder="Search by name, email, or phone…"
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
              <TableHead className="pl-4">Borrower</TableHead>
              <TableHead>Loan Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="text-sm font-medium">No leads match your search</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query.trim()
                      ? `Nothing found for “${query.trim()}”. Try a name, company or lead ID.`
                      : "There are no leads in this workflow yet."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="pl-4">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{l.company} · {l.reference}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{l.loanType}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{inr(l.amount)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{l.entityType}</TableCell>
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
                  <Badge variant="outline" className={`${STAGE_TONE[l.stage]} whitespace-nowrap`}>{l.stage}</Badge>
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Case actions">
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

/* ------------------------------- Board (12-stage kanban) ------------------------------- */

function BoardView({
  leads,
  stages,
  onMoveStage,
}: {
  leads: Lead[];
  stages: ApiStage[];
  onMoveStage: (leadId: string, toStageId: string, toStageName: Stage) => void;
}) {
  const stageIdByName = React.useMemo(() => new Map(stages.map((s) => [s.name, s.id])), [stages]);
  // Options come from the API's stages once loaded (so each name resolves to an
  // id for the PATCH); before then, fall back to the static list so the current
  // stage still renders while the move control is disabled.
  const options: readonly string[] = stages.length ? stages.map((s) => s.name) : STAGES;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div key={stage} className="flex w-72 shrink-0 flex-col rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <span className="truncate text-sm font-medium">{stage}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="flex min-h-24 flex-col gap-2 p-2">
                {items.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">No leads</div>
                ) : (
                  items.map((l) => (
                    <div key={l.id} className="rounded-lg border bg-background p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{l.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{inr(l.amount)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{l.company} · {l.reference}</div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <Badge variant="outline" className="border-primary/20 bg-primary/10 text-[11px] font-normal text-primary">
                          {l.loanType}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{l.entityType}</span>
                      </div>
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
  const [view, setView] = React.useState<View>("All Cases");
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [stages, setStages] = React.useState<ApiStage[]>([]);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  // No auth checks here by design: AppChrome won't render this page without a
  // session, and it redirects centrally if the API rejects the token. These
  // handlers only swallow AuthRequiredError so a redirect-in-flight doesn't
  // also flash an error card.

  // Load leads + stages from the live API (apps/api) — tenant-scoped via RLS.
  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Resolve the workflow from the API rather than assuming a slug — this
      // used to pass nothing and silently land on "business-loan", which does
      // not exist for a college or a CA firm.
      const [rows, workflows] = await Promise.all([listCases(), listWorkflows()]);
      setLeads(rows.map(toLead));
      const slug = workflows[0]?.slug;
      setStages(slug ? await listStages(slug) : []);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }, []);

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
        setMoveError(e instanceof Error ? e.message : "Couldn't move the lead. Please try again.");
      }
    },
    [leads],
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
            Every borrower in the pipeline and where each file stands.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkflowSelect />
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={18} /> Case
          </Button>
          <Button variant="outline" size="icon" aria-label="More options">
            <Icon name="more_vert" size={18} />
          </Button>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b">
        {VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              view === v
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
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
            <div className="font-medium">Couldn&rsquo;t load leads</div>
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
          <span className="text-sm">Loading leads…</span>
        </Card>
      ) : (
        <>
      {/* Suspense: AllCasesView reads useSearchParams (?q= from the header search). */}
      {view === "All Cases" ? (
        <React.Suspense>
          <AllCasesView leads={leads} onRefresh={refresh} />
        </React.Suspense>
      ) : null}
      {view === "Board" ? <BoardView leads={leads} stages={stages} onMoveStage={moveStage} /> : null}
      {view === "Action" ? (
        <Placeholder
          title="Action queues"
          blurb="Work items the AI workforce and humans need to act on for this workflow."
          chips={["Notifications", "Manual Reminders", "Human First Tasks", "AI Assistant Tasks"]}
        />
      ) : null}
      {view === "List" ? (
        <Placeholder
          title="List view"
          blurb="Dense table with comment-tracking columns."
          chips={["Contact", "Stage", "Tag / Next Contact", "Latest Comment", "Last Contacted"]}
        />
      ) : null}
      {view === "Dashboard" ? (
        <Placeholder
          title="Workflow dashboard"
          blurb="Per-workflow lead analytics — conversion by stage, source mix, SLA and ageing."
        />
      ) : null}
      {view === "Settings" ? (
        <Placeholder
          title="Workflow settings"
          blurb="Workflow details and the configurable lead field schema (Form / JSON)."
          chips={["pan_number", "company_name", "loan_amount", "loan_type", "entity_type", "source", "monthly_turnover", "funds_needed"]}
        />
      ) : null}
        </>
      )}

      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          try {
            await createCase(input);
            refresh();
          } catch (e) {
            if (e instanceof AuthRequiredError) return; // AppChrome redirects
            throw e; // let the dialog show its own inline error
          }
        }}
      />
    </div>
  );
}
