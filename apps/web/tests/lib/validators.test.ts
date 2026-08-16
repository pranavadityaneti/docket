import { describe, expect, it } from "vitest";
import {
  sanitizeEmail,
  sanitizeInteger,
  sanitizeLoginId,
  sanitizePhone,
  sanitizeSlug,
  setKeyedError,
  validateContactForm,
  validateEmail,
  validateLoginId,
  validateMemberTitle,
  validatePassword,
  validatePersonName,
  validatePhone,
} from "@/lib/validators";

describe("validatePersonName", () => {
  it("requires a trimmed value", () => {
    expect(validatePersonName("  ")).toMatch(/required/i);
    expect(validatePersonName("Ramesh Kumar")).toBeNull();
  });

  it("honours a custom ceiling", () => {
    expect(validatePersonName("Priya Shah", { max: 80 })).toBeNull();
    expect(validatePersonName("x".repeat(81), { max: 80, label: "Name" })).toMatch(
      /at most 80/i,
    );
  });
});

describe("validateLoginId", () => {
  it("requires a value", () => {
    expect(validateLoginId("")).toMatch(/required/i);
    expect(validateLoginId("  ")).toMatch(/required/i);
  });

  it("accepts a DPU public id", () => {
    expect(validateLoginId("DPU-A12B3C4")).toBeNull();
    expect(validateLoginId("dpu-a12b3c4")).toBeNull();
  });

  it("rejects chosen usernames and short codes", () => {
    expect(validateLoginId("priya.shah")).toMatch(/DPU-/i);
    expect(validateLoginId("DPU-ABC")).toMatch(/DPU-/i);
  });
});

describe("validateEmail", () => {
  it("allows empty unless required", () => {
    expect(validateEmail("")).toBeNull();
    expect(validateEmail("", { required: true })).toMatch(/required/i);
  });

  it("rejects a bare @ check", () => {
    expect(validateEmail("not-an-email")).toMatch(/email/i);
    expect(validateEmail("a@b")).toMatch(/email/i);
    expect(validateEmail("name@example.com")).toBeNull();
  });
});

describe("input sanitizers", () => {
  it("keeps only digits on phone, up to 10", () => {
    expect(sanitizePhone("+91 98450 11223")).toBe("9198450112");
    expect(sanitizePhone("call-me!!")).toBe("");
  });

  it("strips spaces from email", () => {
    expect(sanitizeEmail(" ada @firm.example ")).toBe("ada@firm.example");
  });

  it("keeps only login-id characters", () => {
    expect(sanitizeLoginId("dpu-a12b3c4!")).toBe("DPU-A12B3C4");
    expect(sanitizeLoginId("priya.shah")).toBe("PRIYASHAH");
  });

  it("keeps only slug characters", () => {
    expect(sanitizeSlug("Harbor Lending!")).toBe("harborlending");
    expect(sanitizeSlug("acme-uat")).toBe("acme-uat");
  });

  it("keeps only digits on integers", () => {
    expect(sanitizeInteger("12,00,000")).toBe("1200000");
    expect(sanitizeInteger("e2+3")).toBe("23");
  });
});

describe("validatePhone", () => {
  it("allows empty or exactly 10 digits", () => {
    expect(validatePhone("")).toBeNull();
    expect(validatePhone("9876543210")).toBeNull();
  });

  it("rejects country codes, spaces, and short values", () => {
    expect(validatePhone("+91 98450 11223")).toMatch(/10-digit/i);
    expect(validatePhone("12345")).toMatch(/10-digit/i);
    expect(validatePhone("call-me!!")).toMatch(/10-digit/i);
  });
});

describe("validatePassword", () => {
  it("enforces the 6-character floor", () => {
    expect(validatePassword("short")).toMatch(/at least 6/i);
    expect(validatePassword("secret")).toBeNull();
  });
});

describe("validateMemberTitle", () => {
  it("is optional and capped", () => {
    expect(validateMemberTitle("")).toBeNull();
    expect(validateMemberTitle("x".repeat(41))).toMatch(/at most 40/i);
  });
});

describe("validateContactForm", () => {
  it("uses prefixed keys so workflow fields stay free", () => {
    expect(
      validateContactForm({
        name: "",
        organisation: "",
        email: "bad",
        phone: "99",
      }).__name,
    ).toMatch(/required/i);
    expect(
      validateContactForm({
        name: "Ada",
        organisation: "",
        email: "ada@example.com",
        phone: "9876543210",
      }),
    ).toEqual({});
  });
});

describe("setKeyedError", () => {
  it("adds, replaces, and clears without churn", () => {
    const first = setKeyedError({}, "__email", "That does not look like an email.");
    expect(first.__email).toMatch(/email/i);
    expect(setKeyedError(first, "__email", null)).toEqual({});
    expect(setKeyedError(first, "__email", first.__email)).toBe(first);
  });
});
