import { matchTenantHost } from "@/lib/tenant-host";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "docket_token";
const ADMIN_SESSION_COOKIE = "docket_admin_session";
const TENANT_SLUG_HEADER = "x-docket-tenant-slug";

const PUBLIC_PREFIXES = ["/login", "/forgot", "/reset", "/admin/login"];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function hasSession(req: NextRequest) {
  // Gate on the httpOnly JWT only. The readable docket_session marker is for
  // client JS (isLoggedIn) - if we treated the marker alone as authed, a
  // missing/expired JWT would 401 forever while middleware bounced /login
  // back into the app ("I'm still where I am").
  return Boolean(req.cookies.get(AUTH_COOKIE)?.value);
}

function hasAdminSession(req: NextRequest) {
  return req.cookies.get(ADMIN_SESSION_COOKIE)?.value === "1";
}

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Edge gate for authenticated routes. Real auth still happens on the API;
 * this stops the app chrome flashing for signed-out users and keeps deep
 * links honest via ?next=.
 *
 * Platform console (`/admin`) uses a separate presence cookie so a tenant
 * session cannot walk into super-admin, and vice versa.
 *
 * Also stamps `x-docket-tenant-slug` when the Host is a tenant subdomain
 * (`acme-uat.finlot.ai` → `acme`) so server components / future loaders can
 * read it without re-parsing.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const hostMatch = matchTenantHost(req.headers.get("host") ?? "");
  const requestHeaders = new Headers(req.headers);
  if (hostMatch) {
    requestHeaders.set(TENANT_SLUG_HEADER, hostMatch.slug);
  }

  const nextOpts = { request: { headers: requestHeaders } };
  const platformAuthed = hasAdminSession(req);
  const tenantAuthed = hasSession(req);

  if (isAdminPath(pathname)) {
    if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
      if (platformAuthed) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
      return NextResponse.next(nextOpts);
    }
    if (!platformAuthed) {
      const login = new URL("/admin/login", req.url);
      login.searchParams.set("next", pathname + req.nextUrl.search);
      return NextResponse.redirect(login);
    }
    return NextResponse.next(nextOpts);
  }

  if (isPublic(pathname)) {
    if (tenantAuthed && (pathname === "/login" || pathname.startsWith("/login/"))) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next(nextOpts);
  }

  if (!tenantAuthed) {
    const next = pathname + req.nextUrl.search;
    const login = new URL("/login", req.url);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  return NextResponse.next(nextOpts);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
