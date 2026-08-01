"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Icon } from "@/components/ui/icon";
import { BuildMarker } from "@/components/build-marker";

type NavItem = {
  title: string;
  symbol: string;
  /** Present only when the screen exists. Everything else renders inert. */
  href?: string;
  /** Marks an item as deliberately-next rather than merely absent. */
  soon?: boolean;
};
type NavGroup = { label: string; items: NavItem[] };

/*
 * Navigation follows what a staff user is trying to DO, not what Gain's menu
 * happened to contain.
 *
 * The previous version mirrored the Gain tenant: 38 entries of which 2 led
 * anywhere, organised around a lending call centre — Employee, Hierarchy,
 * Auctions, Queues, Routing Rules, Disposition Codes, Supervisor. Docket places
 * outbound AI calls as the last rung of a nudge ladder; it does not run an
 * inbound agent floor, and that menu is unreadable to a college or a CA firm.
 *
 * The important change is not the pruning, it is the axis. Gain split work by
 * CHANNEL — Calling, Whatsapp, Email as three destinations. Docket's whole
 * premise is that channels are invisible: a borrower replies on WhatsApp,
 * emails a scan two days later, and both land on one case. A channel-first menu
 * asks staff "which inbox is it in?" — the exact question this product exists
 * to abolish. So channels appear once, under Setup, as the number and mailbox
 * we operate on the tenant's behalf.
 *
 * Labels stay deliberately neutral. A workflow carries its own vocabulary
 * (Borrower / Student / Client) and the screens use it, but a tenant running
 * two workflows would otherwise get a menu that renames itself depending on
 * where you last clicked.
 *
 * `soon` is reserved for the next things actually being built. It is not a
 * roadmap parking lot — an item nobody is working on should not be here at all,
 * because a menu full of promises is a menu that lies.
 */
const NAV: NavGroup[] = [
  {
    label: "Work",
    items: [
      { title: "Overview", symbol: "dashboard", href: "/" },
      // The exceptions queue: inbound documents that matched no case, waiting
      // for a human to route them. (Documents awaiting review join this screen
      // in a later pass — one queue, not two menu items.)
      { title: "Needs attention", symbol: "pending_actions", href: "/unmatched" },
      { title: "Cases", symbol: "folder_shared", href: "/cases" },
      // The party documents come from, across all their cases — where a
      // reusable document is answered once instead of re-collected.
      { title: "Contacts", symbol: "contacts", href: "/contacts" },
    ],
  },
  {
    label: "Activity",
    items: [
      // One thread per case with WhatsApp and email interleaved. Deliberately
      // not two menu items.
      { title: "Conversations", symbol: "forum" },
      { title: "Follow-ups", symbol: "campaign" },
      { title: "Calls", symbol: "call" },
    ],
  },
  {
    label: "Setup",
    items: [
      { title: "Workflows", symbol: "account_tree", href: "/workflows" },
      // The tenant's own number and mailbox under their own brand — the USP,
      // configured once rather than worked out of.
      { title: "Channels", symbol: "hub", href: "/channels" },
      { title: "Integrations", symbol: "extension" },
      { title: "Team", symbol: "group" },
      { title: "Settings", symbol: "settings", href: "/settings" },
    ],
  },
];

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  // "/" would otherwise prefix-match every route and light up permanently.
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground">
            D
          </div>
          <div className="grid leading-tight">
            <span className="text-sm font-semibold">Docket</span>
            <span className="text-xs text-muted-foreground">Finlot</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-1 py-2">
        {NAV.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const inner = (
                  <>
                    <Icon name={item.symbol} size={20} fill={active} />
                    <span>{item.title}</span>
                    {item.soon ? (
                      <span className="ml-auto rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                        Soon
                      </span>
                    ) : null}
                  </>
                );

                return (
                  <SidebarMenuItem key={item.title}>
                    {item.href ? (
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={active}
                        tooltip={item.title}
                        className="h-9 gap-3 px-3"
                      >
                        {inner}
                      </SidebarMenuButton>
                    ) : (
                      // No href, so there is nothing to navigate to: a real
                      // disabled button, which browsers already keep out of the
                      // tab order and screen readers already announce as
                      // unavailable.
                      //
                      // Deliberately no `tooltip` here. Passing one wraps this
                      // in a base-ui TooltipTrigger, which converts `disabled`
                      // into aria-disabled so a disabled control can still
                      // explain itself — leaving the item focusable and needing
                      // a tabIndex={-1} workaround to undo. The tooltip would
                      // buy nothing anyway: it only renders while the sidebar
                      // is collapsed, and this sidebar is `collapsible:
                      // "offcanvas"`, so collapsing slides it off screen
                      // entirely rather than to an icon rail.
                      <SidebarMenuButton
                        disabled
                        className="h-9 cursor-default gap-3 px-3 text-sidebar-foreground/55"
                      >
                        {inner}
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Which deployment you are looking at — see build-marker.tsx. */}
      <SidebarFooter className="px-4 py-3">
        <BuildMarker />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
