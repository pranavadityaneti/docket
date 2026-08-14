"use client";

import {
  fetchPlatformMe,
  getStoredPlatformProfile,
  writePlatformProfile,
  type PlatformProfile,
} from "@/features/platform/api";
import { hasPrivilege, type PlatformPrivilege } from "@/features/platform/roles";
import { AuthRequiredError } from "@/lib/http";
import * as React from "react";

type Session = {
  profile: PlatformProfile | null;
  reload: () => void;
};

const PlatformSessionContext = React.createContext<Session>({
  profile: null,
  reload: () => {},
});

export function PlatformSessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = React.useState<PlatformProfile | null>(null);

  const load = React.useCallback(() => {
    setProfile(getStoredPlatformProfile());
    void fetchPlatformMe()
      .then((me) => {
        writePlatformProfile(me);
        setProfile(me);
      })
      .catch((err) => {
        if (err instanceof AuthRequiredError) setProfile(null);
      });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const value = React.useMemo(() => ({ profile, reload: load }), [profile, load]);
  return (
    <PlatformSessionContext.Provider value={value}>{children}</PlatformSessionContext.Provider>
  );
}

export function usePlatformSession() {
  return React.useContext(PlatformSessionContext);
}

export function usePlatformPrivilege(privilege: PlatformPrivilege): boolean {
  const { profile } = usePlatformSession();
  return hasPrivilege(profile?.privileges, privilege);
}
