import { describe, expect, it } from "vitest";
import {
  agoFromMs,
  formatDate,
  formatDateTime,
  formatFileSize,
  initials,
  plural,
  relativeTime,
  relativeTimeOrNever,
} from "@/lib/format";

describe("plural", () => {
  it("handles regular and irregular-ish english nouns", () => {
    expect(plural("Case")).toBe("Cases");
    expect(plural("Enquiry")).toBe("Enquiries");
    expect(plural("Box")).toBe("Boxes");
    expect(plural("Admission")).toBe("Admissions");
  });
});

describe("initials", () => {
  it("takes first and last name letters", () => {
    expect(initials("Ramesh Kumar")).toBe("RK");
    expect(initials("Madonna")).toBe("MA");
    expect(initials("   ")).toBe("?");
  });
});

describe("dates and sizes", () => {
  it("formats nulls safely", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(null, "never")).toBe("never");
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("formatDateTime returns empty for garbage", () => {
    expect(formatDateTime("nope")).toBe("");
  });

  it("formatDateTime uppercases AM/PM", () => {
    const label = formatDateTime("2026-08-06T02:02:00.000Z");
    expect(label).toMatch(/\b(AM|PM)\b/);
    expect(label).not.toMatch(/\b(am|pm)\b/);
  });
});

describe("relativeTime", () => {
  it("returns empty for invalid iso", () => {
    expect(relativeTime("not-a-date")).toBe("");
  });

  it("relativeTimeOrNever maps null to never", () => {
    expect(relativeTimeOrNever(null)).toBe("never");
  });
});

describe("agoFromMs", () => {
  it("matches case-detail freshness wording", () => {
    expect(agoFromMs(null)).toBe("just now");
    expect(agoFromMs(Date.now() - 2000)).toBe("just now");
    expect(agoFromMs(Date.now() - 12_000)).toBe("12s ago");
    expect(agoFromMs(Date.now() - 120_000)).toBe("2m ago");
  });
});
