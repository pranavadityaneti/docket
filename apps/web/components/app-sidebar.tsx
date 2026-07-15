"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
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
import { Icon } from "@/components/ui/icon";
import { logout } from "@/lib/api";

type NavLeaf = { title: string; symbol: string; href?: string };
type NavNode = { title: string; symbol: string; href?: string; items?: NavLeaf[] };

// Mirrors the live Gain tenant's navigation (8 modules, ~35 screens).
// Only screens that actually exist in Docket carry an href; the rest are
// inert (dimmed) until their page is built — so nothing 404s.
const NAV: NavNode[] = [
  { title: "Dashboard", symbol: "dashboard", href: "/" },
  { title: "Contacts", symbol: "contacts" },
  {
    title: "Human Resource",
    symbol: "groups",
    items: [
      { title: "Employee", symbol: "badge" },
      { title: "Hierarchy", symbol: "account_tree" },
    ],
  },
  {
    title: "Sales",
    symbol: "filter_alt",
    items: [
      { title: "Leads", symbol: "person_search", href: "/leads" },
      { title: "Partners", symbol: "handshake" },
      { title: "Auctions", symbol: "gavel" },
    ],
  },
  {
    title: "Calling",
    symbol: "call",
    items: [
      { title: "Assistants", symbol: "support_agent" },
      { title: "Agent Attempts", symbol: "format_list_bulleted" },
      { title: "Inbound Dashboard", symbol: "call_received" },
      { title: "Transfer Dashboard", symbol: "swap_horiz" },
      { title: "Inbound Analytics", symbol: "bar_chart" },
      { title: "Queues", symbol: "format_list_numbered" },
      { title: "Queue Monitor", symbol: "monitor" },
      { title: "Skills", symbol: "star" },
      { title: "Agent Skills", symbol: "manage_accounts" },
      { title: "Routing Rules", symbol: "alt_route" },
      { title: "Inbound Numbers", symbol: "dialpad" },
      { title: "Voice Menu", symbol: "list_alt" },
      { title: "Disposition Codes", symbol: "checklist" },
      { title: "Recording", symbol: "radio_button_checked" },
      { title: "Supervisor", symbol: "supervisor_account" },
    ],
  },
  {
    title: "Whatsapp",
    symbol: "chat",
    items: [
      { title: "Chat", symbol: "forum" },
      { title: "Assistants", symbol: "support_agent" },
    ],
  },
  {
    title: "Email",
    symbol: "mail",
    items: [
      { title: "Inbox", symbol: "inbox" },
      { title: "Assistants", symbol: "support_agent" },
      { title: "Assignments", symbol: "assignment_ind" },
      { title: "Template", symbol: "description" },
    ],
  },
  {
    title: "Integrations",
    symbol: "hub",
    items: [
      { title: "Pipes", symbol: "account_tree" },
      { title: "Plugins", symbol: "extension" },
      { title: "Tags", symbol: "sell" },
      { title: "Blueprints", symbol: "grid_view" },
    ],
  },
];

function leafActive(pathname: string, href?: string) {
  if (!href) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const groupHasActive = (node: NavNode) =>
    !!node.items?.some((leaf) => leafActive(pathname, leaf.href));

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
        <SidebarMenu className="gap-1">
          {NAV.map((node) => {
            // Standalone leaf (Dashboard, Contacts)
            if (!node.items) {
              const active = leafActive(pathname, node.href);
              const inner = (
                <>
                  <Icon name={node.symbol} size={20} fill={active} />
                  <span>{node.title}</span>
                </>
              );
              return (
                <SidebarMenuItem key={node.title}>
                  {node.href ? (
                    <SidebarMenuButton
                      render={<Link href={node.href} />}
                      isActive={active}
                      tooltip={node.title}
                      className="h-9 gap-3 px-3"
                    >
                      {inner}
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      tooltip={node.title}
                      className="h-9 gap-3 px-3 text-sidebar-foreground/60"
                    >
                      {inner}
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              );
            }

            // Collapsible module (Human Resource, Sales, Calling, …)
            const isOpen = open[node.title] ?? groupHasActive(node);
            return (
              <SidebarMenuItem key={node.title}>
                <SidebarMenuButton
                  tooltip={node.title}
                  className="h-9 gap-3 px-3"
                  onClick={() =>
                    setOpen((s) => ({ ...s, [node.title]: !isOpen }))
                  }
                >
                  <Icon name={node.symbol} size={20} />
                  <span>{node.title}</span>
                  <Icon
                    name="expand_more"
                    size={18}
                    className={`ml-auto text-muted-foreground transition-transform ${
                      isOpen ? "" : "-rotate-90"
                    }`}
                  />
                </SidebarMenuButton>
                {isOpen ? (
                  <SidebarMenuSub className="gap-0.5">
                    {node.items.map((leaf) => {
                      const active = leafActive(pathname, leaf.href);
                      const inner = (
                        <>
                          <Icon name={leaf.symbol} size={18} fill={active} />
                          <span>{leaf.title}</span>
                        </>
                      );
                      return (
                        <SidebarMenuSubItem key={leaf.title}>
                          {leaf.href ? (
                            <SidebarMenuSubButton
                              render={<Link href={leaf.href} />}
                              isActive={active}
                              className="h-8 gap-2.5"
                            >
                              {inner}
                            </SidebarMenuSubButton>
                          ) : (
                            <SidebarMenuSubButton className="h-8 gap-2.5 text-sidebar-foreground/55">
                              {inner}
                            </SidebarMenuSubButton>
                          )}
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="gap-3" />}>
                <Avatar className="size-8 rounded-md">
                  <AvatarFallback className="rounded-md bg-secondary text-xs">
                    DA
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Demo Admin</span>
                  <span className="truncate text-xs text-muted-foreground">
                    admin@finlot.ai
                  </span>
                </div>
                <Icon
                  name="unfold_more"
                  size={18}
                  className="ml-auto text-muted-foreground"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-(--anchor-width) min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="py-1.5">
                    <div className="grid leading-tight">
                      <span className="text-sm font-medium text-foreground">Demo Admin</span>
                      <span className="text-xs font-normal text-muted-foreground">admin@finlot.ai</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                    <Icon name="logout" size={16} />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
