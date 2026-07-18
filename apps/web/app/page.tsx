import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import Link from "next/link";

/* ------------------------------------------------------------------ *
 * Home = guided next-best-action cockpit. The opposite of Gain's empty
 * dashboard-builder: on login it tells you what needs you and shows what
 * the AI workforce handled. Mock data uses our real stages/triggers.
 * ------------------------------------------------------------------ */

type Urgency = "high" | "medium" | "low";

const URGENCY_DOT: Record<Urgency, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

const NBA: {
  urgency: Urgency;
  icon: string;
  who: string;
  sub?: string;
  reason: string;
  time: string;
  action: string;
  actionIcon: string;
}[] = [
  { urgency: "high", icon: "badge", who: "Anil Kapoor", sub: "Kapoor Motors", reason: "Missing PAN — blocks the file", time: "5h", action: "Request PAN", actionIcon: "send" },
  { urgency: "high", icon: "call", who: "Karan Malhotra", sub: "KM Retail", reason: "Auto-Follow-Up stalled · no answer in 8h", time: "8h", action: "Call", actionIcon: "call" },
  { urgency: "medium", icon: "description", who: "3 bank statements", reason: "Failed validation — needs a human", time: "2h", action: "Review", actionIcon: "arrow_forward" },
  { urgency: "medium", icon: "folder_open", who: "Priya Mehta", sub: "Mehta Textiles", reason: "PVT-LTD docs 2/5 · borrower idle 5h", time: "5h", action: "Nudge", actionIcon: "chat" },
  { urgency: "medium", icon: "support_agent", who: "Deepa Iyer", sub: "Iyer Fabrics", reason: "AI escalated — borrower asked for a human", time: "6h", action: "Take over", actionIcon: "swap_horiz" },
  { urgency: "low", icon: "verified", who: "Rohit Sharma", sub: "Sharma Steel", reason: "Approved · awaiting e-sign 9h", time: "9h", action: "Send e-sign", actionIcon: "draw" },
];

const PULSE: { icon: string; label: string; value: string; accent?: boolean }[] = [
  { icon: "call", label: "Calls made", value: "42" },
  { icon: "phone_in_talk", label: "Connected", value: "8" },
  { icon: "description", label: "Docs collected", value: "12" },
  { icon: "mail", label: "Emails sent", value: "19" },
  { icon: "priority_high", label: "Escalated to you", value: "5", accent: true },
];

const KPIS: { label: string; value: string; note: string; icon: string; tone: string }[] = [
  { label: "Leads in flight", value: "342", note: "+8% this week", icon: "group", tone: "bg-primary/10 text-primary" },
  { label: "Docs auto-cleared", value: "68%", note: "by the engine", icon: "task_alt", tone: "bg-primary/10 text-primary" },
  { label: "SLA breaches", value: "5", note: "needs attention", icon: "warning", tone: "bg-red-50 text-red-600" },
  { label: "Pending reviews", value: "3", note: "exceptions only", icon: "inbox", tone: "bg-amber-50 text-amber-600" },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Band 1 — greeting + status */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Here&rsquo;s what needs you today</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">6 items</span> need you · your AI workforce cleared{" "}
            <span className="font-medium text-foreground">73 tasks</span> today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1.5">
            <Icon name="auto_awesome" size={18} /> Ask Copilot
          </Button>
          <Link href="/cases?new=1" className={cn(buttonVariants(), "gap-1.5")}>
            <Icon name="add" size={18} /> New lead
          </Link>
        </div>
      </div>

      {/* Band 2 — Needs you now (hero) */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Needs you now</CardTitle>
          <CardDescription>Prioritised by urgency — the next move on each, decided for you.</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              View all <Icon name="arrow_outward" size={15} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {NBA.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <span className={`size-2 shrink-0 rounded-full ${URGENCY_DOT[item.urgency]}`} />
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon name={item.icon} size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {item.who}
                  {item.sub ? <span className="font-normal text-muted-foreground"> · {item.sub}</span> : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">{item.reason}</div>
              </div>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{item.time}</span>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
                <Icon name={item.actionIcon} size={16} /> {item.action}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Band 3 — AI workforce pulse */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your AI workforce today</CardTitle>
          <CardDescription>What your agents handled autonomously — and what they sent you.</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              Activity <Icon name="arrow_outward" size={15} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {PULSE.map((p) => (
              <div key={p.label} className="rounded-lg border p-3">
                <div className={`flex items-center gap-1.5 text-xs ${p.accent ? "text-primary" : "text-muted-foreground"}`}>
                  <Icon name={p.icon} size={15} /> {p.label}
                </div>
                <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${p.accent ? "text-primary" : ""}`}>
                  {p.value}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Band 4 — pipeline at a glance */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{k.label}</span>
                <div className={`flex size-8 items-center justify-center rounded-md ${k.tone}`}>
                  <Icon name={k.icon} size={18} />
                </div>
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{k.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{k.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
