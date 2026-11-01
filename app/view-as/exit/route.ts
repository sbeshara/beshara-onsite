import { NextResponse, type NextRequest } from "next/server";
import { cookieDomain } from "@/lib/supabase/cookies";
import { VIEW_AS_COOKIE } from "@/lib/viewas";

export async function GET(request: NextRequest) {
  // Back to Team & Access on OnSite (also when leaving from HQ).
  const res = NextResponse.redirect(new URL("/team", process.env.NEXT_PUBLIC_SITE_URL ?? request.url));
  res.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0, domain: cookieDomain(request.headers.get("host")) });
  return res;
}
