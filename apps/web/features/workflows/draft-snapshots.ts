import type { ApiFieldDef, ApiRequirement } from "@/features/workflows/api";

export type DraftField = ApiFieldDef & { _clientId: string; keyLocked: boolean };
export type DraftStage = {
  _clientId: string;
  id?: string;
  name: string;
  tone: string;
  position: number;
};
export type DraftReq = {
  _clientId: string;
  id?: string;
  key: string;
  keyLocked: boolean;
  label: string;
  description: string;
  required: boolean;
  maxFiles: number;
  reusable: boolean;
  validityDays: string;
  conditionField: string;
  conditionEquals: string;
  position: number;
};

/** Snapshots match what Save would POST - dirty = draft ≠ last loaded/saved. */
export function snapIdentity(
  name: string,
  subjectLabel: string,
  caseLabel: string,
  description: string,
): string {
  return JSON.stringify({
    name: name.trim(),
    subjectLabel: subjectLabel.trim(),
    caseLabel: caseLabel.trim(),
    description: description.trim() || null,
  });
}

export function snapStages(stages: DraftStage[]): string {
  return JSON.stringify(
    stages.map((s, i) => ({
      id: s.id ?? null,
      name: s.name.trim(),
      tone: s.tone,
      position: i,
    })),
  );
}

export function snapFields(fields: DraftField[]): string {
  return JSON.stringify(
    fields.map((f, i) => ({
      field_key: f.field_key.trim(),
      label: f.label.trim(),
      field_type: f.field_type,
      input_type: f.input_type,
      required: f.required,
      options: f.input_type === "dropdown" ? f.options ?? [] : undefined,
      placeholder: f.placeholder ?? null,
      order: i,
      show_in_table: f.show_in_table ?? false,
      format: f.format ?? null,
    })),
  );
}

export function snapRequirements(reqs: DraftReq[]): string {
  return JSON.stringify(
    reqs.map((r, i) => {
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
        id: r.id ?? null,
        key: r.key.trim(),
        label: r.label.trim(),
        description: r.description.trim() || null,
        required: r.required,
        maxFiles: r.maxFiles,
        reusable: r.reusable,
        validityDays: r.validityDays.trim()
          ? Number(r.validityDays.trim())
          : null,
        condition,
        position: i,
      };
    }),
  );
}
