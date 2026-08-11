import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "docket_token";

const PUBLIC_PREFIXES = ["/login", "/forgot", "/reset"];

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

/**
 * Edge gate for authenticated routes. Real auth still happens on the API;
 * this stops the app chrome flashing for signed-out users and keeps deep
 * links honest via ?next=.
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

  const authed = hasSession(req);

  if (isPublic(pathname)) {
    if (authed && (pathname === "/login" || pathname.startsWith("/login/"))) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (!authed) {
    const next = pathname + req.nextUrl.search;
    const login = new URL("/login", req.url);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
