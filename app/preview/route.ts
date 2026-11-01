import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE } from "@/lib/preview";
import { cookieDomain } from "@/lib/supabase/cookies";
import { VIEW_AS_COOKIE } from "@/lib/viewas";

// Starts "View as client" for one project. Only honored for the Principal Contractor and Admin.
export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get("project") ?? "";
  const res = NextResponse.redirect(new URL("/", request.url));
  if (/^[0-9a-f-]{36}$/i.test(project)) {
    res.cookies.set(PREVIEW_COOKIE, project, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 4 });
    res.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0, domain: cookieDomain(request.headers.get("host")) });
  }
  return res;
}
