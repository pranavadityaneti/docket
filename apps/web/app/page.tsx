import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Users,
  FileCheck,
  TriangleAlert,
  Inbox,
  Plus,
  ArrowUpRight,
} from "lucide-react";

const KPIS = [
  { label: "Leads in flight", value: "342", delta: "+8% this week", icon: Users, tone: "accent" },
  { label: "Doc completion", value: "68%", delta: "avg across active files", icon: FileCheck, tone: "neutral" },
  { label: "SLA breaches", value: "5", delta: "this week", icon: TriangleAlert, tone: "danger" },
  { label: "Pending reviews", value: "3", delta: "needs attention", icon: Inbox, tone: "warn" },
] as const;

const LEADS = [
  { name: "Ramesh Kumar", biz: "Kumar Traders", product: "Term Loan", amount: "₹40,00,000", stage: "Qualifying", tone: "teal" },
  { name: "Priya Mehta", biz: "Mehta Textiles", product: "LAP", amount: "₹1,20,00,000", stage: "Docs pending", tone: "amber" },
  { name: "Arjun Nair", biz: "Nair Logistics", product: "Working Capital", amount: "₹25,00,000", stage: "Complete", tone: "green" },
  { name: "Sana Shaikh", biz: "SS Enterprises", product: "Term Loan", amount: "₹18,00,000", stage: "Qualifying", tone: "teal" },
  { name: "Vikram Rao", biz: "Rao Foods", product: "Business Loan", amount: "₹55,00,000", stage: "Dropped", tone: "muted" },
];

const CAMPAIGNS = [
  { name: "SME Term Loan Onboarding", lender: "HDFC Bank", leads: 156, health: "Good", tone: "green" },
  { name: "LAP Application Drive", lender: "Axis Bank", leads: 89, health: "Delayed", tone: "amber" },
  { name: "Top-up Outreach", lender: "Bajaj Finserv", leads: 45, health: "At risk", tone: "red" },
];

const BADGE_TONE: Record<string, string> = {
  teal: "border-primary/20 bg-primary/10 text-primary",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  red: "border-red-200 bg-red-50 text-red-700",
  muted: "border-border bg-muted text-muted-foreground",
};

const KPI_ICON_TONE: Record<string, string> = {
  accent: "bg-primary/10 text-primary",
  danger: "bg-red-50 text-red-600",
  warn: "bg-amber-50 text-amber-600",
  neutral: "bg-muted text-muted-foreground",
};

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command centre</h1>
          <p className="text-sm text-muted-foreground">
            Every active loan campaign in one view — leads, documents, SLAs, and what needs a human today.
          </p>
        </div>
        <Button className="gap-1.5">
          <Plus className="size-4" /> New lead
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{k.label}</span>
                <div className={`flex size-8 items-center justify-center rounded-md ${KPI_ICON_TONE[k.tone]}`}>
                  <k.icon className="size-4" />
                </div>
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{k.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{k.delta}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Pipeline activity</CardTitle>
            <CardDescription>Recent leads and where each file stands.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                View all <ArrowUpRight className="size-3.5" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Borrower</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="pr-6 text-right">Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LEADS.map((l) => (
                  <TableRow key={l.name}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.biz}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.product}</TableCell>
                    <TableCell className="tabular-nums">{l.amount}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <Badge variant="outline" className={BADGE_TONE[l.tone]}>{l.stage}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign health</CardTitle>
            <CardDescription>Active origination campaigns.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {CAMPAIGNS.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.lender} · {c.leads} leads
                  </div>
                </div>
                <Badge variant="outline" className={BADGE_TONE[c.tone]}>{c.health}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
