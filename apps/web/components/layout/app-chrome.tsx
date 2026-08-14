"use client";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
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
    <ToastProvider>
      <SidebarProvider>
        <MobileNavCloser pathname={pathname} />
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-x-hidden">
          <AppHeader />
          <div className="flex-1 overflow-x-hidden p-3 sm:p-4 md:p-5">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </ToastProvider>
  );
}

/** Sheet stays open across soft nav unless something closes it - painful on phone. */
function MobileNavCloser({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  return null;
}
