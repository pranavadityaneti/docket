import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRequiredError,
  friendlyErrorMessage,
  getServerStoredProfile,
  getStoredProfile,
  writeProfile,
  type LoginProfile,
} from "@/lib/http";
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

  it("rewrites the Nest throttler exception into a wait-and-retry line", () => {
    expect(
      friendlyErrorMessage(
        JSON.stringify({ message: "ThrottlerException: Too Many Requests" }),
        "fallback",
      ),
    ).toBe("Too many attempts. Please wait a few minutes and try again.");
  });
});

describe("getStoredProfile", () => {
  const sample: LoginProfile = {
    user: { id: "u1", name: "Priya", email: "priya@firm.example" },
    tenant: { id: "t1", name: "Finlot", slug: "finlot" },
    role: "owner",
  };

  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
      },
    });
  });

  it("returns the same object while localStorage is unchanged", () => {
    writeProfile(sample);
    expect(getStoredProfile()).toBe(getStoredProfile());
  });

  it("returns a new snapshot after the stored profile changes", () => {
    writeProfile(sample);
    const first = getStoredProfile();
    writeProfile({ ...sample, role: "admin" });
    const second = getStoredProfile();
    expect(second).not.toBe(first);
    expect(second?.role).toBe("admin");
  });

  it("is null on the server snapshot", () => {
    expect(getServerStoredProfile()).toBeNull();
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
