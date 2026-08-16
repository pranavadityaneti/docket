"use client";

import { DocketMark } from "@/components/brand/docket-mark";
import { BuildMarker } from "@/components/layout/build-marker";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import {
  PLATFORM_AUTH_REQUIRED_EVENT,
  platformLogout,
} from "@/features/platform/api";
import { hasPrivilege, platformRoleLabel } from "@/features/platform/roles";
import { PlatformSessionProvider, usePlatformPrivilege, usePlatformSession } from "@/features/platform/session";
import { initials } from "@/lib/format";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

const NAV = [
  { title: "Overview", symbol: "dashboard", href: "/admin" },
  { title: "Tenants", symbol: "apartment", href: "/admin/tenants" },
  { title: "Operators", symbol: "admin_panel_settings", href: "/admin/operators", privilege: "operators.read" as const },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function PlatformChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    const onAuthRequired = () => {
      const here =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : pathname;
      router.replace(`/admin/login?next=${encodeURIComponent(here)}`);
    };
    window.addEventListener(PLATFORM_AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(PLATFORM_AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [router, pathname]);

  return (
    <ToastProvider>
      <PlatformSessionProvider>
        <SidebarProvider>
          <MobileNavCloser pathname={pathname} />
          <PlatformSidebar />
          <SidebarInset className="min-w-0 overflow-x-hidden">
            <PlatformHeader />
            <div className="flex-1 overflow-x-hidden p-3 sm:p-4 md:p-5">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </PlatformSessionProvider>
    </ToastProvider>
  );
}

function MobileNavCloser({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  return null;
}

function PlatformSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const canWriteTenants = usePlatformPrivilege("tenants.write");
  const { profile } = usePlatformSession();

  const nav = NAV.filter((item) =>
    "privilege" in item ? hasPrivilege(profile?.privileges, item.privilege) : true,
  );

  return (
    <Sidebar className="border-sidebar-border">
      <SidebarHeader className="px-4 pb-2 pt-5">
        <Link href="/admin" className="flex items-center px-1 py-1">
          <DocketMark className="h-8 w-auto max-w-full" />
        </Link>
        {canWriteTenants ? (
          <Button
            className="mt-3 w-full justify-start gap-2"
            onClick={() => router.push("/admin/tenants?new=1")}
          >
            <Icon name="add" size={18} />
            New tenant
          </Button>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="px-2 py-1">
        <SidebarGroup className="py-2">
          <SidebarGroupLabel className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Console
          </SidebarGroupLabel>
          <SidebarMenu className="gap-0.5">
            {nav.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={isActive(pathname, item.href)}
                  tooltip={item.title}
                  className="h-9 gap-3 rounded-[8px] px-3 data-[active=true]:bg-muted data-[active=true]:font-semibold data-[active=true]:text-foreground"
                >
                  <Icon name={item.symbol} size={18} fill={false} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        <BuildMarker />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function PlatformHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = usePlatformSession();

  const title =
    pathname === "/admin"
      ? "Overview"
      : pathname.startsWith("/admin/tenants/")
        ? "Tenant"
        : pathname.startsWith("/admin/tenants")
          ? "Tenants"
          : pathname.startsWith("/admin/operators")
            ? "Operators"
            : "Platform";

  async function handleLogout() {
    await platformLogout();
    router.push("/admin/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{title}</div>
      <div className="flex items-center gap-2">
        {profile ? (
          <span className="hidden max-w-[240px] truncate text-xs text-muted-foreground sm:inline">
            {profile.user.email}
            <span className="text-muted-foreground/70"> · {platformRoleLabel(profile.role)}</span>
          </span>
        ) : null}
        <div
          className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold"
          title={profile?.user.name}
        >
          {initials(profile?.user.name ?? "P")}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleLogout()}>
          <Icon name="logout" size={16} />
          Sign out
        </Button>
      </div>
    </header>
  );
}
