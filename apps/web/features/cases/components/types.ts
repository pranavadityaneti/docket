import type { ApiCase } from "@/features/cases/api";
import type { ApiFieldDef, ApiWorkflow } from "@/features/workflows/api";
import { relativeTime } from "@/lib/format";

export type Source =
  | "Portal"
  | "Whatsapp"
  | "Email"
  | "Referral"
  | "Website"
  | "Other";

export type Stage = string;

export type Lead = {
  id: string;
  reference: string;
  name: string;
  company: string;
  source: Source;
  stage: Stage;
  stageTone: string | null;
  owner: string;
  activity: string;
  data: Record<string, unknown> | null;
};

export const VIEWS = ["Table", "Board"] as const;
export type View = (typeof VIEWS)[number];

export const WORKFLOW_STORAGE_KEY = "docket_workflow_slug";

function str(
  data: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.trim() !== ""
    ? value
    : undefined;
}

export function toStage(name: string | null): Stage {
  return name?.trim() || "-";
}

export function toLead(caseItem: ApiCase): Lead {
  return {
    id: caseItem.id,
    reference: caseItem.reference,
    name: caseItem.subjectName ?? "-",
    company: caseItem.subjectOrganisation ?? "-",
    source: (caseItem.source ?? str(caseItem.data, "source") ?? "Other") as Source,
    stage: toStage(caseItem.stageName),
    stageTone: caseItem.stageTone,
    owner: caseItem.ownerName?.trim() || "Unassigned",
    activity: relativeTime(caseItem.updatedAt),
    data: caseItem.data,
  };
}

export function cellValue(
  data: Record<string, unknown> | null,
  field: ApiFieldDef,
): string {
  const raw = data?.[field.field_key];
  if (raw === null || raw === undefined || raw === "") return "-";
  if (field.field_type === "integer") {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) return "-";
    return field.format === "inr" ? inr(value) : String(value);
  }
  return String(raw);
}

export const MAX_DOMAIN_COLUMNS = 3;

export function tableFields(workflow: ApiWorkflow | null): ApiFieldDef[] {
  return (workflow?.fields ?? [])
    .filter((field) => field.show_in_table)
    .slice(0, MAX_DOMAIN_COLUMNS);
}

export function inr(value: number): string {
  return "₹" + value.toLocaleString("en-IN");
}
