"use client";

import { AuthRequiredError } from "@/lib/http";
import * as React from "react";

export type AsyncResourceState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Re-run the loader with the visible refresh indicator. */
  reload: () => void;
  /** Re-run the loader with no spinner / "Checking..." chrome. */
  silentReload: () => void;
};

type Options = {
  /** Message when the thrown value is not an Error. */
  fallbackError?: string;
  /**
   * When true, the first paint starts in loading. Set false when you seed
   * from cache and only want a background refresh indicator.
   */
  initialLoading?: boolean;
  /**
   * Silent background poll while the page is mounted and the tab is visible.
   * Failures stay quiet when data is already on screen.
   */
  pollIntervalMs?: number;
};

type RunMode = "initial" | "refresh" | "silent";

/**
 * Race-safe async load for list/detail screens.
 *
 * A generation counter drops stale responses: switch workflow fast, navigate
 * away, or remount under Strict Mode, and an older request cannot overwrite
 * newer state. AuthRequiredError is swallowed - AppChrome handles redirect.
 */
export function useAsyncResource<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
  options: Options = {},
): AsyncResourceState<T> {
  const {
    fallbackError = "Couldn't load.",
    initialLoading = true,
    pollIntervalMs,
  } = options;
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(initialLoading);
  const [refreshing, setRefreshing] = React.useState(false);
  const genRef = React.useRef(0);
  const loaderRef = React.useRef(loader);
  const inFlightRef = React.useRef(false);
  const hasDataRef = React.useRef(false);

  React.useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const run = React.useCallback(
    (mode: RunMode) => {
      if (mode === "silent" && inFlightRef.current) return;
      const gen = ++genRef.current;
      inFlightRef.current = true;
      if (mode === "initial") setLoading(true);
      else if (mode === "refresh") setRefreshing(true);

      void (async () => {
        try {
          const next = await loaderRef.current();
          if (gen !== genRef.current) return;
          setData(next);
          hasDataRef.current = true;
          setError(null);
        } catch (e) {
          if (gen !== genRef.current) return;
          if (e instanceof AuthRequiredError) return;
          // Silent polls keep the last good screen; shouting about a blip
          // trains people to ignore real errors.
          if (mode === "silent" && hasDataRef.current) return;
          setError(e instanceof Error ? e.message : fallbackError);
        } finally {
          if (gen !== genRef.current) return;
          setLoading(false);
          setRefreshing(false);
          inFlightRef.current = false;
        }
      })();
    },
    [fallbackError],
  );

  React.useEffect(() => {
    // Fetching on mount / dep change is what an effect is for - syncing with
    // an external system. Same pattern as Cases/Overview screens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run("initial");
    return () => {
      // Invalidate in-flight work when deps change or the component unmounts.
      genRef.current += 1;
      inFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps passed by caller
  }, deps);

  React.useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      run("silent");
    };

    const id = window.setInterval(tick, pollIntervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") run("silent");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollIntervalMs, run]);

  const reload = React.useCallback(() => run("refresh"), [run]);
  const silentReload = React.useCallback(() => run("silent"), [run]);

  return { data, error, loading, refreshing, reload, silentReload };
}
