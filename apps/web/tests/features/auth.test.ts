import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POST_LOGIN, safeNext } from "@/features/auth/safe-next";
import {
  getWorkspacePrefs,
  setWorkspacePrefs,
  type WorkspacePrefs,
} from "@/features/auth/api";

describe("safeNext", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNext("/cases")).toBe("/cases");
    expect(safeNext("/cases?q=1")).toBe("/cases?q=1");
    expect(safeNext("/cases/abc#x")).toBe("/cases/abc#x");
  });

  it("rejects open redirects and non-paths", () => {
    expect(safeNext("https://evil.example")).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext("//evil.example")).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext("javascript:alert(1)")).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext(null)).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext("")).toBe(DEFAULT_POST_LOGIN);
  });

  it("accepts a custom fallback", () => {
    expect(safeNext(null, "/")).toBe("/");
  });
});

describe("workspace prefs", () => {
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

  it("returns defaults when storage empty", () => {
    const prefs = getWorkspacePrefs();
    expect(prefs.notifyNeedsReview).toBe(true);
    expect(prefs.notifyUnmatched).toBe(true);
    expect(prefs.notifyFollowUps).toBe(true);
  });

  it("round-trips prefs", () => {
    const next: WorkspacePrefs = {
      notifyNeedsReview: false,
      notifyUnmatched: true,
      notifyFollowUps: false,
    };
    setWorkspacePrefs(next);
    expect(getWorkspacePrefs()).toEqual(next);
  });

  it("survives corrupt json", () => {
    store.set("docket_prefs", "{not-json");
    expect(getWorkspacePrefs().notifyNeedsReview).toBe(true);
  });
});
