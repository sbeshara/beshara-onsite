import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// reports.besharabuilders.com serves Beshara Reports (the /studio pages) from this same app.
const isReportsHost = (host: string | null) => !!host && host.startsWith("reports.");
const SHARED = ["/login", "/auth", "/api", "/studio", "/welcome", "/account"];

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const path = request.nextUrl.pathname;
  if (response.headers.get("location") || !isReportsHost(request.headers.get("host"))) return response;
  if (SHARED.some((p) => path === p || path.startsWith(p + "/"))) return response;

  const url = request.nextUrl.clone();
  url.pathname = path === "/" ? "/studio" : `/studio${path}`;
  const rewritten = NextResponse.rewrite(url, { request });
  response.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
  return rewritten;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|hero.jpg|manifest.webmanifest|sample|sample.html|sw.js).*)"],
};
