import { apiFetch } from "@/lib/http";

/** Shape returned by GET /workflows/:slug/stages. */
export type ApiStage = {
  id: string;
  name: string;
  tone: string;
  position: number;
};

/**
 * One domain field a workflow collects (mirrors FieldDef in @docket/db).
 *
 * `show_in_table` is why this reaches the client: which domain values earn a
 * column on the Cases table is the workflow's configuration, not this app's
 * guess.
 */
export type ApiFieldDef = {
  field_key: string;
  label: string;
  field_type: "string" | "integer" | "enum";
  input_type: "text" | "number" | "dropdown" | "textarea";
  required: boolean;
  options?: string[];
  validation?: Record<string, unknown>;
  placeholder?: string;
  order: number;
  show_in_table?: boolean;
  format?: "inr";
};

export type ApiWorkflow = {
  id: string;
  name: string;
  slug: string;
  subjectLabel: string;
  caseLabel: string;
  fields: ApiFieldDef[];
};

export function listWorkflows(): Promise<ApiWorkflow[]> {
  return apiFetch<ApiWorkflow[]>("/workflows");
}

export function listStages(workflow: string): Promise<ApiStage[]> {
  return apiFetch<ApiStage[]>(`/workflows/${encodeURIComponent(workflow)}/stages`);
}
