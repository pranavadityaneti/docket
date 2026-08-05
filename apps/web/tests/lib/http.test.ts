import { describe, expect, it } from "vitest";
import { friendlyErrorMessage, AuthRequiredError } from "@/lib/http";
import { toneClass, TONE_CLASS } from "@/lib/tones";

describe("friendlyErrorMessage", () => {
  it("prefers string message", () => {
    expect(friendlyErrorMessage(JSON.stringify({ message: "Slot full" }), "fallback")).toBe(
      "Slot full",
    );
  });

  it("joins class-validator arrays", () => {
    expect(
      friendlyErrorMessage(JSON.stringify({ message: ["a required", "b invalid"] }), "x"),
    ).toBe("a required. b invalid");
  });

  it("falls back when body is not json", () => {
    expect(friendlyErrorMessage("<<<html>>>", "boom")).toBe("boom");
  });
});

describe("AuthRequiredError", () => {
  it("has a stable name", () => {
    const e = new AuthRequiredError();
    expect(e.name).toBe("AuthRequiredError");
    expect(e.message).toBe("Not authenticated");
  });
});

describe("toneClass", () => {
  it("falls back to muted", () => {
    expect(toneClass(null)).toBe(TONE_CLASS.muted);
    expect(toneClass("amber")).toContain("pastel-peach");
  });
});
