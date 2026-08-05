"use client";

import { AuthRequiredError } from "@/lib/http";
import * as React from "react";

export type AsyncResourceState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Re-run the loader. Safe under Strict Mode and rapid re-deps. */
  reload: () => void;
};

type Options = {
  /** Message when the thrown value is not an Error. */
  fallbackError?: string;
  /**
   * When true, the first paint starts in loading. Set false when you seed
   * from cache and only want a background refresh indicator.
   */
  initialLoading?: boolean;
};

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
  const { fallbackError = "Couldn't load.", initialLoading = true } = options;
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(initialLoading);
  const [refreshing, setRefreshing] = React.useState(false);
  const genRef = React.useRef(0);
  const loaderRef = React.useRef(loader);

  React.useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const run = React.useCallback(
    (mode: "initial" | "refresh") => {
      const gen = ++genRef.current;
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);

      void (async () => {
        try {
          const next = await loaderRef.current();
          if (gen !== genRef.current) return;
          setData(next);
          setError(null);
        } catch (e) {
          if (gen !== genRef.current) return;
          if (e instanceof AuthRequiredError) return;
          setError(e instanceof Error ? e.message : fallbackError);
        } finally {
          if (gen !== genRef.current) return;
          setLoading(false);
          setRefreshing(false);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps passed by caller
  }, deps);

  const reload = React.useCallback(() => run("refresh"), [run]);

  return { data, error, loading, refreshing, reload };
}
