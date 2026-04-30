import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const COOKIE_NAME = "session";

// Paths that are accessible without auth (after stripping locale prefix)
const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

function stripLocale(pathname: string): string {
  // Remove leading locale segment, e.g. /zh-CN/chat -> /chat
  for (const locale of routing.locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(`/${locale}`.length) || "/";
    }
  }
  return pathname;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const pathWithoutLocale = stripLocale(pathname);
  const hasCookie = request.cookies.has(COOKIE_NAME);

  // Detect current locale from pathname
  const locale =
    routing.locales.find((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`)) ||
    routing.defaultLocale;

  // If the user is authenticated and tries to access public pages, redirect to /chat —
  // unless ?expired=1 is set, which means the backend invalidated the session and we
  // need to clear the stale cookie and show the login page.
  if (PUBLIC_PATHS.has(pathWithoutLocale)) {
    if (hasCookie) {
      if (request.nextUrl.searchParams.get("expired") === "1") {
        const response = intlMiddleware(request);
        response.cookies.delete(COOKIE_NAME);
        return response;
      }
      const chatUrl = new URL(`/${locale}/chat`, request.url);
      return NextResponse.redirect(chatUrl);
    }
    return intlMiddleware(request);
  }

  // If not authenticated, redirect to /login
  if (!hasCookie) {
    // Let intlMiddleware determine the locale first so we can build the redirect URL
    const locale =
      routing.locales.find((l) => pathname.startsWith(`/${l}/`) || pathname === `/${l}`) ||
      routing.defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("next", pathWithoutLocale);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — run intl middleware normally
  return intlMiddleware(request);
}

export const config = {
  // Match all paths except Next.js internals, static files, and API routes
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
