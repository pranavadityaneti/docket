import { describe, expect, it } from "vitest";
import { stripResolvedImagePlaceholders } from "@/lib/email-body";

describe("stripResolvedImagePlaceholders", () => {
  it("removes Apple Mail stubs when the file is attached", () => {
    const body = [
      "Sending now",
      "",
      "[image: Screenshot 2026-08-12 at 9.59.52 PM.png]",
      "",
      "Thanks",
    ].join("\n");

    expect(
      stripResolvedImagePlaceholders(body, [
        "Screenshot 2026-08-12 at 9.59.52 PM.png",
      ]),
    ).toBe("Sending now\n\nThanks");
  });

  it("keeps stubs when no matching attachment exists", () => {
    const body = "[image: missing.png]\n\nping";
    expect(stripResolvedImagePlaceholders(body, ["other.png"])).toBe(body);
  });

  it("is case-insensitive on file names", () => {
    expect(
      stripResolvedImagePlaceholders("[image: Foo.PNG]", ["foo.png"]),
    ).toBe("");
  });
});
