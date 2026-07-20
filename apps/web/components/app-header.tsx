"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logout } from "@/lib/api";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/cases": "Cases",
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
  "/settings": "Settings",
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
  const router = useRouter();

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Focus once the field has been given width to expand into.
  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  function submitSearch() {
    const q = query.trim();
    if (!q) return;
    router.push(`/cases?q=${encodeURIComponent(q)}`);
  }

  // The icon is a three-way toggle: open when closed, submit when it has a
  // term, close when open but empty.
  function onSearchIconClick() {
    if (!searchOpen) return setSearchOpen(true);
    if (query.trim()) return submitSearch();
    closeSearch();
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 data-[orientation=vertical]:h-5"
      />
      <span className="text-sm font-medium">{titleForPath(pathname)}</span>
      <div className="ml-auto flex items-center gap-1">
        {/* Expands leftwards out of the search icon. Width+opacity are
            transitioned rather than mounting/unmounting, so it animates both
            ways and the input keeps its focus/value while open. */}
        <div
          className={`overflow-hidden transition-[width,opacity] duration-300 ease-out ${
            searchOpen ? "w-56 opacity-100 md:w-72" : "w-0 opacity-0"
          }`}
        >
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
            // Neutral wording on purpose: the header is outside any workflow,
            // so it has no vocabulary to borrow. The Cases screen this submits
            // to uses the workflow's own noun.
            placeholder="Search cases…"
            aria-label="Search cases"
            aria-hidden={!searchOpen}
            tabIndex={searchOpen ? 0 : -1}
            className="h-8 bg-muted/50"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search"
          aria-expanded={searchOpen}
          onClick={onSearchIconClick}
        >
          <Icon name="search" size={20} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Icon name="notifications" size={20} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="ml-0.5 rounded-full"
                aria-label="Account"
              />
            }
          >
            <Avatar className="size-7">
              <AvatarFallback className="bg-secondary text-[11px]">DA</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="py-1.5">
                <div className="grid leading-tight">
                  <span className="text-sm font-medium text-foreground">Demo Admin</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    admin@finlot.ai
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Icon name="settings" size={16} />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                <Icon name="logout" size={16} />
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
