import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { PREVIEW_COOKIE } from "@/lib/preview";
import { cookieDomain } from "@/lib/supabase/cookies";
import { isAdminRole } from "@/lib/types";
import { VIEW_AS_COOKIE } from "@/lib/viewas";

// Starts "View as" someone. Only honored for the Principal Contractor and Admins.
export async function GET(request: NextRequest) {
  const me = await getMe();
  const user = request.nextUrl.searchParams.get("user") ?? "";
  // Back where they picked it: HQ, or the OnSite dashboard.
  const res = NextResponse.redirect(new URL(request.nextUrl.searchParams.get("to") === "hq" ? hqHome(request) : "/", request.url));
  if (!isAdminRole(me.role) || !/^[0-9a-f-]{36}$/i.test(user)) return res;
  const domain = cookieDomain(request.headers.get("host"));
  res.cookies.set(VIEW_AS_COOKIE, user, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 4, domain });
  res.cookies.delete(PREVIEW_COOKIE);
  return res;
}

// HQ's home: "/" on hq.besharabuilders.com, "/hq" anywhere else.
const hqHome = (request: NextRequest) => (request.headers.get("host")?.startsWith("hq.") ? "/" : "/hq");
