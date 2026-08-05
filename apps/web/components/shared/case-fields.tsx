"use client";

import { Input, fieldControlClassName } from "@/components/ui/input";
import type { ApiFieldDef } from "@/features/workflows/api";
import * as React from "react";

/* ------------------------------------------------------------------ *
 * Rendering and validating a workflow's own fields.
 *
 * Shared because two screens now collect the same values - the New Case
 * dialog and the case Overview's edit form - and a workflow that validates
 * one way on create and another way on edit is a workflow with two
 * definitions. Everything here is driven by FieldDef, so a lender, a college
 * and a CA firm get their own labels, options and rules without a line of
 * code naming any of them.
 * ------------------------------------------------------------------ */

/** Native selects / textareas - same 42×8 geometry as Input. */
export const FIELD_CLASS = `flex ${fieldControlClassName}`;

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function Field({
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
      <label className="text-sm font-medium">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

/** One field, rendered from the workflow's own field config. */
export function DynamicField({
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
          {!field.required ? <option value="">-</option> : null}
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
 * `minimum`/`maximum` mean VALUE for integers and LENGTH for strings - that is
 * how the config uses them (PAN carries minimum 10, maximum 10 alongside its
 * regex).
 */
export function validateField(field: ApiFieldDef, raw: string): string | null {
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

/** The stored value of a field as an editable string. */
export function fieldToInput(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Editable strings back to stored values, typed as the config says. */
export function inputsToData(
  fields: ApiFieldDef[],
  values: Record<string, string>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.field_key] ?? "").trim();
    // An emptied field is sent as null so it can be CLEARED, not silently kept.
    data[f.field_key] = raw === "" ? null : f.field_type === "integer" ? Number(raw) : raw;
  }
  return data;
}
