import { NextResponse, type NextRequest } from "next/server";
import { cookieDomain } from "@/lib/supabase/cookies";
import { VIEW_AS_COOKIE } from "@/lib/viewas";

export async function GET(request: NextRequest) {
  // Back to HQ when leaving from there, otherwise the OnSite dashboard.
  const to = request.nextUrl.searchParams.get("to") === "hq" ? new URL(hqHome(request), request.url) : new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? request.url);
  const res = NextResponse.redirect(to);
  res.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0, domain: cookieDomain(request.headers.get("host")) });
  return res;
}

// HQ's home: "/" on hq.besharabuilders.com, "/hq" anywhere else.
const hqHome = (request: NextRequest) => (request.headers.get("host")?.startsWith("hq.") ? "/" : "/hq");
