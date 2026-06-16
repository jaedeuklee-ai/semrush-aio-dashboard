import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, expectedToken, gateEnabled } from "@/lib/auth";

// Paths that must stay reachable without the cookie:
// - the login page + its API
// - cron/admin routes (they authenticate themselves via CRON_SECRET/ADMIN_TOKEN,
//   and Vercel Cron has no cookie)
function isPublic(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/login")) return true;
  if (pathname.startsWith("/api/cron")) return true;
  if (pathname.startsWith("/api/admin")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();
  if (!gateEnabled()) return NextResponse.next(); // gate off until APP_PASSWORD is set

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const ok = cookie != null && cookie === (await expectedToken());
  if (ok) return NextResponse.next();

  // Not authenticated.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
