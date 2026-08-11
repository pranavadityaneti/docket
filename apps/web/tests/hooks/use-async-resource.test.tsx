/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { AuthRequiredError } from "@/lib/http";

describe("useAsyncResource", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads data on mount", async () => {
    const loader = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAsyncResource(loader, []));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: true });
    expect(result.current.error).toBeNull();
  });

  it("drops stale responses when deps change", async () => {
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>((r) => {
      resolveFirst = r;
    });
    const loader = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce("second");

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncResource(() => loader(key), [key]),
      { initialProps: { key: "a" } },
    );

    rerender({ key: "b" });
    await waitFor(() => expect(result.current.data).toBe("second"));

    // Late first response must not overwrite.
    await act(async () => {
      resolveFirst("first");
    });
    expect(result.current.data).toBe("second");
  });

  it("swallows AuthRequiredError without setting error", async () => {
    const loader = vi.fn().mockRejectedValue(new AuthRequiredError());
    const { result } = renderHook(() => useAsyncResource(loader, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("surfaces other errors", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useAsyncResource(loader, [], { fallbackError: "Couldn't load." }),
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("silentReload updates data without refreshing flag", async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ n: 1 })
      .mockResolvedValueOnce({ n: 2 });
    const { result } = renderHook(() => useAsyncResource(loader, []));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    await act(async () => {
      result.current.silentReload();
    });
    // Never flips the visible refresh chrome.
    expect(result.current.refreshing).toBe(false);
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.refreshing).toBe(false);
  });

  it("pollIntervalMs silently reloads while the tab is visible", async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ n: 1 })
      .mockResolvedValueOnce({ n: 2 });
    const { result } = renderHook(() =>
      useAsyncResource(loader, [], { pollIntervalMs: 1_000 }),
    );
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.refreshing).toBe(false);
  });
});
