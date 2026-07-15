"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AUTH_REQUIRED_EVENT, isLoggedIn } from "@/lib/api";

// Routes that need no session AND render standalone, without the app's
// sidebar/header. These two properties currently coincide; split the list if a
// route ever needs one without the other (e.g. a full-screen authenticated
// document viewer, which would be chromeless but still private).
const PUBLIC_PREFIXES = ["/login"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Wraps every route: renders public routes bare, and gates everything else
 * behind a session.
 *
 * This is a UX guard, not a security boundary — it stops the app painting for
 * someone with no session, but anyone can edit client JS. The real protection
 * is the API, which authenticates every request and scopes data by tenant via
 * RLS. Gating lives here (rather than a Next middleware) because the token is
 * in localStorage, which the server/edge can't read; if the token ever moves
 * to an httpOnly cookie, this should become real middleware.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);

  // null = undetermined. localStorage is unreadable during SSR, so the first
  // render must be indeterminate on both server and client to avoid a
  // hydration mismatch; the effect below resolves it right after mount.
  const [authed, setAuthed] = React.useState<boolean | null>(null);

  const toLogin = React.useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [router, pathname]);

  // Every non-public route is gated in this one place, so a newly added page is
  // private by default rather than by remembering to guard it.
  React.useEffect(() => {
    if (isPublic) return;
    const ok = isLoggedIn();
    setAuthed(ok);
    if (!ok) toLogin();
  }, [isPublic, pathname, toLogin]);

  // The check above only knows whether a token *exists*. If the API rejects it
  // (expired/revoked mid-session), lib/api fires this event — handled centrally
  // so no page needs its own 401 redirect.
  React.useEffect(() => {
    if (isPublic) return;
    const onAuthRequired = () => {
      setAuthed(false);
      toLogin();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [isPublic, toLogin]);

  if (isPublic) return <>{children}</>;

  // Hold the paint until a session is confirmed, otherwise the sidebar and page
  // flash into view before the redirect lands.
  if (authed !== true) return null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="flex-1 bg-muted/30 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
