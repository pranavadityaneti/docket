import { describe, expect, it } from "vitest";
import { TONE_SWATCH, toneSwatch } from "@/lib/tones";

describe("tone swatches", () => {
  it("maps every known tone to a bg class", () => {
    for (const tone of Object.keys(TONE_SWATCH)) {
      expect(toneSwatch(tone)).toMatch(/^bg-/);
    }
  });

  it("falls back to muted", () => {
    expect(toneSwatch("nope")).toBe(TONE_SWATCH.muted);
    expect(toneSwatch(null)).toBe(TONE_SWATCH.muted);
  });
});
