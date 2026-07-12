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

type StageKey =
  | "new"
  | "qualifying"
  | "docs"
  | "submitted"
  | "approved"
  | "dropped";

type Lead = {
  id: string;
  name: string;
  business: string;
  product: string;
  amount: number;
  stage: StageKey;
  owner: string;
  source: string;
  activity: string;
};

const STAGES: { key: StageKey; label: string; tone: string }[] = [
  { key: "new", label: "New", tone: "border-primary/20 bg-primary/10 text-primary" },
  { key: "qualifying", label: "Qualifying", tone: "border-primary/20 bg-primary/10 text-primary" },
  { key: "docs", label: "Docs pending", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  { key: "submitted", label: "Submitted", tone: "border-sky-200 bg-sky-50 text-sky-700" },
  { key: "approved", label: "Approved", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "dropped", label: "Dropped", tone: "border-border bg-muted text-muted-foreground" },
];

const STAGE_MAP = Object.fromEntries(
  STAGES.map((s) => [s.key, s]),
) as Record<StageKey, (typeof STAGES)[number]>;

const LEADS: Lead[] = [
  { id: "L-1042", name: "Zoya Khan", business: "Khan Jewellers", product: "LAP", amount: 15000000, stage: "new", owner: "Rahul Verma", source: "Website", activity: "1h ago" },
  { id: "L-1041", name: "Imran Sheikh", business: "Sheikh Motors", product: "Machinery Loan", amount: 3200000, stage: "new", owner: "Rahul Verma", source: "Website", activity: "20m ago" },
  { id: "L-1040", name: "Farah Ali", business: "Ali Exports", product: "Term Loan", amount: 4700000, stage: "new", owner: "Vikram Rao", source: "Website", activity: "45m ago" },
  { id: "L-1039", name: "Ramesh Kumar", business: "Kumar Traders", product: "Term Loan", amount: 4000000, stage: "qualifying", owner: "Aisha Khan", source: "Website", activity: "2h ago" },
  { id: "L-1038", name: "Sana Shaikh", business: "SS Enterprises", product: "Term Loan", amount: 1800000, stage: "qualifying", owner: "Vikram Rao", source: "Website", activity: "3h ago" },
  { id: "L-1037", name: "Suresh Patel", business: "Patel Agro", product: "Business Loan", amount: 6100000, stage: "qualifying", owner: "Rahul Verma", source: "Google Ads", activity: "4h ago" },
  { id: "L-1036", name: "Priya Mehta", business: "Mehta Textiles", product: "LAP", amount: 12000000, stage: "docs", owner: "Rahul Verma", source: "WhatsApp", activity: "5h ago" },
  { id: "L-1035", name: "Karan Malhotra", business: "KM Retail", product: "LAP", amount: 8500000, stage: "docs", owner: "Neha Gupta", source: "Referral", activity: "8h ago" },
  { id: "L-1034", name: "Deepa Iyer", business: "Iyer Fabrics", product: "Working Capital", amount: 900000, stage: "submitted", owner: "Aisha Khan", source: "WhatsApp", activity: "6h ago" },
  { id: "L-1033", name: "Rohit Sharma", business: "Sharma Steel", product: "Machinery Loan", amount: 7300000, stage: "submitted", owner: "Neha Gupta", source: "Referral", activity: "9h ago" },
  { id: "L-1032", name: "Arjun Nair", business: "Nair Logistics", product: "Working Capital", amount: 2500000, stage: "approved", owner: "Aisha Khan", source: "Referral", activity: "1d ago" },
  { id: "L-1031", name: "Ananya Bose", business: "Bose Interiors", product: "Working Capital", amount: 1500000, stage: "approved", owner: "Aisha Khan", source: "Website", activity: "1d ago" },
  { id: "L-1030", name: "Vikram Rao", business: "Rao Foods", product: "Business Loan", amount: 5500000, stage: "dropped", owner: "Neha Gupta", source: "Google Ads", activity: "2d ago" },
  { id: "L-1029", name: "Meera Nanda", business: "Nanda Pharma", product: "Term Loan", amount: 3900000, stage: "dropped", owner: "Vikram Rao", source: "WhatsApp", activity: "3d ago" },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

function StagePill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-xs tabular-nums ${
          active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export default function LeadsPage() {
  const [stage, setStage] = React.useState<StageKey | "all">("all");
  const [query, setQuery] = React.useState("");

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: LEADS.length };
    for (const s of STAGES) c[s.key] = LEADS.filter((l) => l.stage === s.key).length;
    return c;
  }, []);

  const filtered = LEADS.filter((l) => {
    if (stage !== "all" && l.stage !== stage) return false;
    const q = query.trim().toLowerCase();
    if (q && !`${l.name} ${l.business} ${l.id}`.toLowerCase().includes(q)) return false;
    return true;
  });

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
          <Button variant="outline" className="gap-1.5">
            <Icon name="upload" size={18} /> Import
          </Button>
          <Button className="gap-1.5">
            <Icon name="add" size={18} /> New lead
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StagePill
          active={stage === "all"}
          onClick={() => setStage("all")}
          label="All"
          count={counts.all}
        />
        {STAGES.map((s) => (
          <StagePill
            key={s.key}
            active={stage === s.key}
            onClick={() => setStage(s.key)}
            label={s.label}
            count={counts[s.key]}
          />
        ))}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="relative w-full max-w-xs">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search borrower, business, or ID…"
              className="pl-8"
            />
          </div>
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {LEADS.length} leads
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Borrower</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.business} · {l.id}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {l.product}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {inr(l.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-border bg-muted font-normal text-muted-foreground"
                    >
                      {l.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar className="size-6">
                        <AvatarFallback className="bg-secondary text-[10px]">
                          {initials(l.owner)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{l.owner}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {l.activity}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STAGE_MAP[l.stage].tone}>
                      {STAGE_MAP[l.stage].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      aria-label="Lead actions"
                    >
                      <Icon name="more_horiz" size={18} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    No leads match your filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t p-3">
          <span className="text-sm text-muted-foreground">
            Showing {filtered.length} of {LEADS.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
