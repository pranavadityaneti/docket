import { describe, expect, it } from "vitest";
import { createCaseSubmitDisabled } from "@/features/cases/components/create-dialog";

describe("createCaseSubmitDisabled", () => {
  it("does not stay disabled after fields are filled", () => {
    expect(createCaseSubmitDisabled({ submitting: false, loading: false })).toBe(false);
  });

  it("blocks only while loading or submitting", () => {
    expect(createCaseSubmitDisabled({ submitting: false, loading: true })).toBe(true);
    expect(createCaseSubmitDisabled({ submitting: true, loading: false })).toBe(true);
  });
});
