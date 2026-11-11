import { NextResponse, type NextRequest } from "next/server";

/**
 * The /api rewrite (next.config.js) does not pass the caller's address to the backend, so the
 * activity log would record this server's address for everyone. Forward it explicitly.
 * A reverse proxy in front of this app must set X-Forwarded-For itself; its first entry is kept.
 */
export function middleware(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const ip = forwarded || req.ip;
  if (!ip) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-for", ip);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
