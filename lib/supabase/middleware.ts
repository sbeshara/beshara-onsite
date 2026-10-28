import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authCookieOptions, cookieDomain, isAuthCookie, LEGACY_AUTH_COOKIE } from "./cookies";

// /api/notify is called by the database, which has no sign-in.
const PUBLIC_PATHS = ["/login", "/auth", "/api/notify", "/api/reports/generate", "/api/checklist/remind"];
const KEEP = 400 * 24 * 60 * 60;

export async function updateSession(request: NextRequest) {
  const host = request.headers.get("host");

  // People signed in before shared sign-in keep their session: copy the old
  // per-address cookie to the shared one and clear the old one.
  const all = request.cookies.getAll();
  const legacy = all.some((c) => isAuthCookie(c.name, AUTH_COOKIE)) ? [] : all.filter((c) => isAuthCookie(c.name, LEGACY_AUTH_COOKIE));
  const moved = legacy.map((c) => ({ old: c.name, name: AUTH_COOKIE + c.name.slice(LEGACY_AUTH_COOKIE.length), value: c.value }));
  for (const m of moved) {
    request.cookies.delete(m.old);
    request.cookies.set(m.name, m.value);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(host),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const finish = (res: NextResponse) => {
    for (const m of moved) {
      if (!res.cookies.get(m.name)) res.cookies.set(m.name, m.value, { path: "/", sameSite: "lax", maxAge: KEEP, domain: cookieDomain(host) });
      res.cookies.set(m.old, "", { path: "/", maxAge: 0 });
    }
    return res;
  };

  const path = request.nextUrl.pathname;
  if (!user && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return finish(response);
}
