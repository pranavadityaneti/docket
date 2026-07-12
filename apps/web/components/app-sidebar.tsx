"use client";

import * as React from "react";
import {
  LayoutDashboard,
  Users,
  Target,
  Handshake,
  Phone,
  MessageCircle,
  Mail,
  FileCheck,
  ClipboardList,
  Inbox,
  Workflow,
  Megaphone,
  ChevronsUpDown,
} from "lucide-react";

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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type NavItem = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  badge?: string;
};
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { label: "Overview", items: [{ title: "Dashboard", icon: LayoutDashboard, active: true }] },
  {
    label: "CRM",
    items: [
      { title: "Contacts", icon: Users },
      { title: "Leads", icon: Target },
      { title: "Partners", icon: Handshake },
    ],
  },
  {
    label: "Engage",
    items: [
      { title: "Calling", icon: Phone },
      { title: "WhatsApp", icon: MessageCircle },
      { title: "Email", icon: Mail },
    ],
  },
  {
    label: "Origination",
    items: [
      { title: "Documents", icon: FileCheck },
      { title: "Blueprints", icon: ClipboardList },
      { title: "Review Queue", icon: Inbox, badge: "3" },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Workflows", icon: Workflow },
      { title: "Campaigns", icon: Megaphone },
    ],
  },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
            D
          </div>
          <div className="grid leading-tight">
            <span className="text-sm font-semibold">Docket</span>
            <span className="text-xs text-muted-foreground">Finlot</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={item.active} tooltip={item.title}>
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                    {item.badge ? (
                      <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
                        {item.badge}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="rounded-md bg-secondary text-xs">DA</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Demo Admin</span>
                <span className="truncate text-xs text-muted-foreground">admin@finlot.ai</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
