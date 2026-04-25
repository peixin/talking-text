import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "session";

const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasCookie = request.cookies.has(COOKIE_NAME);

  if (PUBLIC_PATHS.has(pathname)) {
    if (hasCookie) {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
    return NextResponse.next();
  }

  if (!hasCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
