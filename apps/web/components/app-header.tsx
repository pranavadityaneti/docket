"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/leads": "Leads",
  "/contacts": "Contacts",
  "/partners": "Partners",
  "/calling": "Calling",
  "/whatsapp": "WhatsApp",
  "/email": "Email",
  "/documents": "Documents",
  "/blueprints": "Blueprints",
  "/review-queue": "Review Queue",
  "/workflows": "Workflows",
  "/campaigns": "Campaigns",
};

function titleForPath(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const match = Object.keys(PAGE_TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_TITLES[match] : "Docket";
}

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 data-[orientation=vertical]:h-5"
      />
      <span className="text-sm font-medium">{titleForPath(pathname)}</span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Search">
          <Icon name="search" size={20} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Icon name="notifications" size={20} />
        </Button>
      </div>
    </header>
  );
}
