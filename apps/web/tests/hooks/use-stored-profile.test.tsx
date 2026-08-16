/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStoredProfile } from "@/hooks/use-stored-profile";
import { writeProfile, type LoginProfile } from "@/lib/http";

const sample: LoginProfile = {
  user: { id: "u1", name: "Priya", email: "priya@firm.example" },
  tenant: { id: "t1", name: "Finlot", slug: "finlot" },
  role: "owner",
};

describe("useStoredProfile", () => {
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

  it("returns the cached profile without looping on rerender", () => {
    writeProfile(sample);
    const { result, rerender } = renderHook(() => useStoredProfile());
    const first = result.current;
    expect(first?.role).toBe("owner");
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });
});
