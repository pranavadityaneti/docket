"use client";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AUTH_REQUIRED_EVENT } from "@/lib/http";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

/**
 * Authenticated chrome under app/(app).
 *
 * Route gating is middleware's job (docket_session cookie). This shell listens
 * for API 401s so an expired JWT still boots the user to login cleanly.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    const onAuthRequired = () => {
      const here =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : pathname;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [router, pathname]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <AppHeader />
        <div className="flex-1 p-4 md:p-5">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
