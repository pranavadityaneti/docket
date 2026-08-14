import { describe, expect, it } from "vitest";
import {
  fieldToInput,
  inputsToData,
  validateField,
} from "@/components/shared/case-fields";
import type { ApiFieldDef } from "@/features/workflows/api";

const panField: ApiFieldDef = {
  field_key: "pan",
  label: "PAN",
  field_type: "string",
  input_type: "text",
  required: true,
  order: 1,
  validation: { regex: "^[A-Z]{5}[0-9]{4}[A-Z]$", minimum: 10, maximum: 10 },
};

const amountField: ApiFieldDef = {
  field_key: "amount",
  label: "Amount",
  field_type: "integer",
  input_type: "number",
  required: true,
  order: 2,
  validation: { minimum: 1000, maximum: 1_000_000 },
};

const optionalField: ApiFieldDef = {
  field_key: "notes",
  label: "Notes",
  field_type: "string",
  input_type: "textarea",
  required: false,
  order: 3,
};

describe("validateField", () => {
  it("requires values when required", () => {
    expect(validateField(panField, "")).toMatch(/required/i);
    expect(validateField(optionalField, "")).toBeNull();
  });

  it("enforces regex and length", () => {
    expect(validateField(panField, "ABCDE1234F")).toBeNull();
    expect(validateField(panField, "bad")).toMatch(/format|characters/i);
  });

  it("enforces integer min/max", () => {
    expect(validateField(amountField, "500")).toMatch(/at least/i);
    expect(validateField(amountField, "5000")).toBeNull();
    expect(validateField(amountField, "nope")).toMatch(/number/i);
  });

  it("never blocks on malformed regex", () => {
    const broken: ApiFieldDef = { ...panField, validation: { regex: "[" } };
    expect(validateField(broken, "anything-long")).toBeNull();
  });
});

describe("inputsToData / fieldToInput", () => {
  it("clears emptied fields as null and types integers", () => {
    expect(fieldToInput(null)).toBe("");
    expect(fieldToInput(42)).toBe("42");
    expect(
      inputsToData([panField, amountField], { pan: "ABCDE1234F", amount: "5000" }),
    ).toEqual({ pan: "ABCDE1234F", amount: 5000 });
    expect(inputsToData([panField], { pan: "  " })).toEqual({ pan: null });
  });
});
