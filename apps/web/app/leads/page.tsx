"use client";

import * as React from "react";
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

/* ------------------------------------------------------------------ *
 * Schema mirrors the live Gain "Business Loan" workflow (see
 * docs/gain-parity-audit.html): the exact 12 board stages, the real
 * lead fields (loan_type / entity_type / source enums), and the six
 * views. "Portal" is spelled correctly here (Gain's enum has a "Protal"
 * typo — we intentionally correct it).
 * ------------------------------------------------------------------ */

const WORKFLOWS = ["Business Loan"] as const;

const VIEWS = [
  "All Leads",
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

type Lead = {
  id: string;
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

const LEADS: Lead[] = [
  { id: "L-1042", name: "Zoya Khan", company: "Khan Jewellers", loanType: "LAP", entityType: "Private Limited", amount: 15000000, source: "Website", monthlyTurnover: 4200000, stage: "PVT LTD Document Collection", owner: "Rahul Verma", activity: "1h ago" },
  { id: "L-1041", name: "Imran Sheikh", company: "Sheikh Motors", loanType: "Working Capital", entityType: "Proprietorship", amount: 3200000, source: "Website", monthlyTurnover: 900000, stage: "Pending", owner: "Rahul Verma", activity: "20m ago" },
  { id: "L-1040", name: "Farah Ali", company: "Ali Exports", loanType: "SME Term Loan", entityType: "Partnership", amount: 4700000, source: "Website", monthlyTurnover: 1500000, stage: "Pending", owner: "Vikram Rao", activity: "45m ago" },
  { id: "L-1039", name: "Ramesh Kumar", company: "Kumar Traders", loanType: "SME Term Loan", entityType: "Proprietorship", amount: 4000000, source: "Website", monthlyTurnover: 1200000, stage: "Proprietorship Documents Collection", owner: "Aisha Khan", activity: "2h ago" },
  { id: "L-1038", name: "Sana Shaikh", company: "SS Enterprises", loanType: "SME Term Loan", entityType: "Partnership", amount: 1800000, source: "Website", monthlyTurnover: 700000, stage: "Partnership Document Collection", owner: "Vikram Rao", activity: "3h ago" },
  { id: "L-1037", name: "Suresh Patel", company: "Patel Agro", loanType: "Working Capital", entityType: "Proprietorship", amount: 6100000, source: "Referral", monthlyTurnover: 2100000, stage: "Follow up", owner: "Rahul Verma", activity: "4h ago" },
  { id: "L-1036", name: "Priya Mehta", company: "Mehta Textiles", loanType: "LAP", entityType: "Private Limited", amount: 12000000, source: "Whatsapp", monthlyTurnover: 3800000, stage: "PVT LTD Document Collection", owner: "Rahul Verma", activity: "5h ago" },
  { id: "L-1035", name: "Karan Malhotra", company: "KM Retail", loanType: "LAP", entityType: "Partnership", amount: 8500000, source: "Referral", monthlyTurnover: 2600000, stage: "Auto Follow-Up", owner: "Neha Gupta", activity: "8h ago" },
  { id: "L-1034", name: "Deepa Iyer", company: "Iyer Fabrics", loanType: "Working Capital", entityType: "Proprietorship", amount: 900000, source: "Whatsapp", monthlyTurnover: 400000, stage: "Human Escalated", owner: "Aisha Khan", activity: "6h ago" },
  { id: "L-1033", name: "Rohit Sharma", company: "Sharma Steel", loanType: "Top-up", entityType: "Private Limited", amount: 7300000, source: "Referral", monthlyTurnover: 3100000, stage: "Completed", owner: "Neha Gupta", activity: "9h ago" },
  { id: "L-1032", name: "Arjun Nair", company: "Nair Logistics", loanType: "Working Capital", entityType: "LLP", amount: 2500000, source: "Referral", monthlyTurnover: 1100000, stage: "Completed", owner: "Aisha Khan", activity: "1d ago" },
  { id: "L-1031", name: "Sunita Reddy", company: "Reddy Constructions", loanType: "LAP", entityType: "Partnership", amount: 9500000, source: "Email", monthlyTurnover: 2900000, stage: "Not Picked", owner: "Aisha Khan", activity: "1d ago" },
  { id: "L-1030", name: "Vikram Rao", company: "Rao Foods", loanType: "SME Term Loan", entityType: "Proprietorship", amount: 5500000, source: "Other", monthlyTurnover: 1800000, stage: "Not Interested", owner: "Neha Gupta", activity: "2d ago" },
  { id: "L-1029", name: "Meera Nanda", company: "Nanda Pharma", loanType: "SME Term Loan", entityType: "Private Limited", amount: 3900000, source: "Whatsapp", monthlyTurnover: 1400000, stage: "No Answer", owner: "Vikram Rao", activity: "3d ago" },
  { id: "L-1028", name: "Anil Kapoor", company: "Kapoor Motors", loanType: "Top-up", entityType: "Proprietorship", amount: 2200000, source: "Portal", monthlyTurnover: 800000, stage: "Missing PanCard", owner: "Rahul Verma", activity: "5h ago" },
];

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

/* ------------------------------- Workflow selector ------------------------------- */

function WorkflowSelect() {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string>(WORKFLOWS[0]);
  return (
    <div className="relative">
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => setOpen((o) => !o)}
      >
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

/* ------------------------------- All Leads (table) ------------------------------- */

function AllLeadsView() {
  const [query, setQuery] = React.useState("");
  const filtered = LEADS.filter((l) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${l.name} ${l.company} ${l.id}`.toLowerCase().includes(q);
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
        <Button variant="outline" size="sm" className="gap-1.5">
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
            {filtered.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="pl-4">
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{l.company} · {l.id}</div>
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
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Lead actions">
                    <Icon name="more_horiz" size={18} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t p-3">
        <span className="text-sm text-muted-foreground">
          Showing {filtered.length} of {LEADS.length}
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

function BoardView() {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3">
        {STAGES.map((stage) => {
          const items = LEADS.filter((l) => l.stage === stage);
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
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{l.company}</div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <Badge variant="outline" className="border-primary/20 bg-primary/10 text-[11px] font-normal text-primary">
                          {l.loanType}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">{l.entityType}</span>
                      </div>
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

export default function LeadsPage() {
  const [view, setView] = React.useState<View>("All Leads");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Every borrower in the pipeline and where each file stands.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkflowSelect />
          <Button className="gap-1.5">
            <Icon name="add" size={18} /> Lead
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

      {view === "All Leads" ? <AllLeadsView /> : null}
      {view === "Board" ? <BoardView /> : null}
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
    </div>
  );
}
