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
import { fetchMe, getWorkspacePrefs, logout } from "@/features/auth/api";
import { getOverview } from "@/features/overview/api";
import { listUnmatched } from "@/features/unmatched/api";
import { getStoredProfile } from "@/lib/http";
import type { LoginProfile } from "@/lib/http";
import { initials } from "@/lib/format";
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
};

function titleForPath(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const match = Object.keys(PAGE_TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_TITLES[match] : "Docket";
}

type AttentionCounts = {
  needsReview: number;
  unmatched: number;
  followUps: number;
};

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = React.useState<LoginProfile | null>(null);
  const [prefs, setPrefs] = React.useState(() => getWorkspacePrefs());
  const [counts, setCounts] = React.useState<AttentionCounts>({
    needsReview: 0,
    unmatched: 0,
    followUps: 0,
  });

  React.useEffect(() => {
    setProfile(getStoredProfile());
    setPrefs(getWorkspacePrefs());
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

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [overview, unmatched] = await Promise.all([
          getOverview(),
          listUnmatched().catch(() => []),
        ]);
        if (cancelled) return;
        setCounts({
          needsReview: overview.totals.documentsAwaitingReview,
          unmatched: unmatched.length,
          followUps: overview.totals.documentsOutstanding,
        });
      } catch {
        // Badge is best-effort - don't block the header.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const badgeTotal =
    (prefs.notifyNeedsReview ? counts.needsReview : 0) +
    (prefs.notifyUnmatched ? counts.unmatched : 0) +
    (prefs.notifyFollowUps ? counts.followUps : 0);

  const displayName = profile?.user.name ?? "Account";
  const displayEmail = profile?.user.email ?? "";

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-background/90 px-4 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 data-[orientation=vertical]:h-4"
      />
      <span className="truncate text-sm font-semibold tracking-tight">
        {titleForPath(pathname)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label={
                  badgeTotal > 0
                    ? `${badgeTotal} items need attention`
                    : "Attention inbox"
                }
              />
            }
          >
            <Icon name="notifications" size={20} />
            {badgeTotal > 0 ? (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                {badgeTotal > 9 ? "9+" : badgeTotal}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Needs attention</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/")}>
              <Icon name="rate_review" size={16} />
              <span className="flex-1">Awaiting review</span>
              <span className="tabular-nums text-muted-foreground">{counts.needsReview}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/unmatched")}>
              <Icon name="mark_email_unread" size={16} />
              <span className="flex-1">Unmatched</span>
              <span className="tabular-nums text-muted-foreground">{counts.unmatched}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/follow-ups")}>
              <Icon name="schedule_send" size={16} />
              <span className="flex-1">Outstanding docs</span>
              <span className="tabular-nums text-muted-foreground">{counts.followUps}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Icon name="tune" size={16} />
              Notification preferences
            </DropdownMenuItem>
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
                  <span className="text-sm font-medium text-foreground">{displayName}</span>
                  {displayEmail ? (
                    <span className="text-xs font-normal text-muted-foreground">{displayEmail}</span>
                  ) : null}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Icon name="settings" size={16} />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void handleLogout()}>
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
