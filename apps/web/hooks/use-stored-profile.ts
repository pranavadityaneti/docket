import { getStoredProfile, type LoginProfile } from "@/lib/http";
import * as React from "react";

const subscribeNoop = () => () => {};
const getClientHydrated = () => true;
const getServerHydrated = () => false;

/**
 * Cached session profile after hydration.
 *
 * useSyncExternalStore snapshots must be referentially stable. Reading
 * JSON.parse(localStorage) as the snapshot itself loops forever (new object
 * every getSnapshot). A boolean hydrated flag is a stable primitive; the
 * profile is then read from the cached getter.
 */
export function useStoredProfile(): LoginProfile | null {
  const hydrated = React.useSyncExternalStore(
    subscribeNoop,
    getClientHydrated,
    getServerHydrated,
  );
  return hydrated ? getStoredProfile() : null;
}
