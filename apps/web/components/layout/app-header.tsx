"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { fetchMe, logout } from "@/features/auth/api";
import {
  listNotifications,
  markNotificationRead,
  NOTIFICATION_KIND_META,
  unreadNotificationCount,
  type ApiNotification,
} from "@/features/notifications/api";
import { getStoredProfile } from "@/lib/http";
import type { LoginProfile } from "@/lib/http";
import { initials, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/cases": "Cases",
  "/contacts": "Contacts",
  "/conversations": "Conversations",
  "/follow-ups": "Follow-ups",
  "/unmatched": "Needs attention",
  "/workflows": "Workflows",
  "/channels": "Channels",
  "/settings": "Settings",
  "/notifications": "Notifications",
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
  const [profile, setProfile] = React.useState<LoginProfile | null>(null);
  const [unread, setUnread] = React.useState(0);
  const [preview, setPreview] = React.useState<ApiNotification[]>([]);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    setProfile(getStoredProfile());
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch(() => {
        // Keep cached profile; 401 is handled globally.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const refreshBell = React.useCallback(async () => {
    try {
      const [count, page] = await Promise.all([
        unreadNotificationCount(),
        listNotifications({ limit: 6 }),
      ]);
      setUnread(count.count);
      setPreview(page.items);
    } catch {
      // Badge is best-effort - don't block the header.
    }
  }, []);

  React.useEffect(() => {
    void refreshBell();
  }, [pathname, refreshBell]);

  // Silent poll so the bell updates when inbound chat / other alerts land
  // without a full navigation. Same cadence as case-detail auto-refresh.
  React.useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refreshBell();
    };
    const id = window.setInterval(tick, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshBell();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshBell]);

  React.useEffect(() => {
    if (menuOpen) void refreshBell();
  }, [menuOpen, refreshBell]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function openNotification(n: ApiNotification) {
    try {
      if (!n.readAt) {
        await markNotificationRead(n.id);
        void refreshBell();
      }
    } catch {
      // Still navigate; read state can catch up on the inbox page.
    }
    if (n.href) router.push(n.href);
    else router.push("/notifications");
  }

  const displayName = profile?.user.name ?? "Account";
  const displayEmail = profile?.user.email ?? "";

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-background/90 px-3 backdrop-blur-sm sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 hidden data-[orientation=vertical]:h-4 sm:block"
      />
      <span className="min-w-0 truncate text-sm font-semibold tracking-tight">
        {titleForPath(pathname)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label={
                  unread > 0
                    ? `${unread} unread notification${unread === 1 ? "" : "s"}`
                    : "Notifications"
                }
              />
            }
          >
            <Icon name="notifications" size={20} />
            {unread > 0 ? (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[min(20rem,calc(100vw-1.5rem))] rounded-[12px] p-0"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-3 py-2.5 text-foreground">
                Notifications
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="m-0" />
              {preview.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nothing in the inbox yet.
                </div>
              ) : (
                preview.map((n) => {
                  const meta =
                    NOTIFICATION_KIND_META[n.kind] ??
                    NOTIFICATION_KIND_META.generic;
                  const isUnread = !n.readAt;
                  return (
                    <DropdownMenuItem
                      key={n.id}
                      className={cn(
                        "items-start gap-2.5 rounded-none px-3 py-2.5",
                        isUnread && "bg-primary/5",
                      )}
                      onClick={() => void openNotification(n)}
                    >
                      <Icon
                        name={meta.icon}
                        size={16}
                        className={cn(
                          "mt-0.5 shrink-0",
                          isUnread ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "truncate text-sm",
                            isUnread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {n.title}
                        </div>
                        {n.body ? (
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {n.body}
                          </div>
                        ) : null}
                        <div className="mt-1 text-[11px] text-muted-foreground/80">
                          {relativeTime(n.createdAt)}
                        </div>
                      </div>
                      {isUnread ? (
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                          aria-hidden
                        />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })
              )}
              <DropdownMenuSeparator className="m-0" />
              <DropdownMenuItem
                className="justify-center rounded-none py-2.5 text-sm font-medium text-primary"
                onClick={() => router.push("/notifications")}
              >
                View all notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Account"
              />
            }
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-muted text-[11px] font-semibold text-foreground">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="py-1.5">
                <div className="grid leading-tight">
                  <span className="text-sm font-medium text-foreground">
                    {displayName}
                  </span>
                  {displayEmail ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {displayEmail}
                    </span>
                  ) : null}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Icon name="settings" size={16} />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void handleLogout()}
              >
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
