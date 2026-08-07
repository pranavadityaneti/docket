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

export type ApiRequirementCondition = {
  field: string;
  equals?: string | number | boolean;
  in?: (string | number)[];
};

export type ApiRequirement = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  required: boolean;
  accepts: string[];
  maxFiles: number;
  reusable: boolean;
  validityDays: number | null;
  condition: ApiRequirementCondition | null;
  position: number;
};

export type ApiWorkflow = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  subjectLabel: string;
  caseLabel: string;
  fields: ApiFieldDef[];
  stageCount?: number;
  requirementCount?: number;
};

export type CreateWorkflowInput = {
  name: string;
  slug?: string;
  subjectLabel: string;
  caseLabel: string;
  description?: string;
};

export type UpdateWorkflowInput = {
  name?: string;
  subjectLabel?: string;
  caseLabel?: string;
  description?: string | null;
};

export type StageInput = {
  id?: string;
  name: string;
  tone: string;
  position: number;
};

export type RequirementInput = {
  id?: string;
  key: string;
  label: string;
  description?: string | null;
  required: boolean;
  accepts?: string[];
  maxFiles: number;
  reusable: boolean;
  validityDays?: number | null;
  condition?: ApiRequirementCondition | null;
  position: number;
};

export function listWorkflows(): Promise<ApiWorkflow[]> {
  return apiFetch<ApiWorkflow[]>("/workflows");
}

export function getWorkflow(slug: string): Promise<ApiWorkflow> {
  return apiFetch<ApiWorkflow>(`/workflows/${encodeURIComponent(slug)}`);
}

export function createWorkflow(input: CreateWorkflowInput): Promise<ApiWorkflow> {
  return apiFetch<ApiWorkflow>("/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWorkflow(
  slug: string,
  input: UpdateWorkflowInput,
): Promise<Pick<ApiWorkflow, "id" | "name" | "slug" | "description" | "subjectLabel" | "caseLabel">> {
  return apiFetch(`/workflows/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteWorkflow(slug: string): Promise<{ ok: true }> {
  return apiFetch(`/workflows/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

export function listStages(workflow: string): Promise<ApiStage[]> {
  return apiFetch<ApiStage[]>(`/workflows/${encodeURIComponent(workflow)}/stages`);
}

export function putStages(workflow: string, stages: StageInput[]): Promise<ApiStage[]> {
  return apiFetch(`/workflows/${encodeURIComponent(workflow)}/stages`, {
    method: "PUT",
    body: JSON.stringify({ stages }),
  });
}

export function listFields(workflow: string): Promise<ApiFieldDef[]> {
  return apiFetch<ApiFieldDef[]>(`/workflows/${encodeURIComponent(workflow)}/fields`);
}

export function putFields(workflow: string, fields: ApiFieldDef[]): Promise<ApiFieldDef[]> {
  return apiFetch(`/workflows/${encodeURIComponent(workflow)}/fields`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
}

export function listRequirements(workflow: string): Promise<ApiRequirement[]> {
  return apiFetch(`/workflows/${encodeURIComponent(workflow)}/requirements`);
}

export function putRequirements(
  workflow: string,
  requirements: RequirementInput[],
): Promise<ApiRequirement[]> {
  return apiFetch(`/workflows/${encodeURIComponent(workflow)}/requirements`, {
    method: "PUT",
    body: JSON.stringify({ requirements }),
  });
}

/** Owner/admin can mutate workflows; agents and reviewers are read-only. */
export function canEditWorkflows(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
