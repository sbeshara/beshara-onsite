import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// The same app serves three addresses:
//   onsite.besharabuilders.com   Beshara OnSite (client chats)
//   reports.besharabuilders.com  Beshara Reports (the /studio pages)
//   hq.besharabuilders.com       Beshara HQ, the team's app launcher (/hq)
const SHARED = ["/login", "/auth", "/api", "/studio", "/hq", "/welcome", "/account"];

function target(host: string | null, path: string) {
  if (!host) return null;
  if (host.startsWith("hq.")) return path === "/" ? "/hq" : null;
  if (host.startsWith("reports.")) {
    if (SHARED.some((p) => path === p || path.startsWith(p + "/"))) return null;
    return path === "/" ? "/studio" : `/studio${path}`;
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  if (response.headers.get("location")) return response;
  const to = target(request.headers.get("host"), request.nextUrl.pathname);
  if (!to) return response;

  const url = request.nextUrl.clone();
  url.pathname = to;
  const rewritten = NextResponse.rewrite(url, { request });
  response.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
  return rewritten;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|hero.jpg|manifest.webmanifest|sample|sample.html|sw.js).*)"],
};
