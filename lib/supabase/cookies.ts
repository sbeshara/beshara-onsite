// One sign-in across hq., onsite. and reports.besharabuilders.com: the
// session cookie is set on the parent domain under a name of our own.
export const AUTH_COOKIE = "sb-beshara-auth-token";

export function cookieDomain(host: string | null | undefined) {
  const h = (host ?? "").split(":")[0].toLowerCase();
  return h === "besharabuilders.com" || h.endsWith(".besharabuilders.com") ? ".besharabuilders.com" : undefined;
}

export const authCookieOptions = (host: string | null | undefined) => ({ name: AUTH_COOKIE, domain: cookieDomain(host) });

// The cookie name the app used before shared sign-in, e.g. "sb-abcd-auth-token".
export const LEGACY_AUTH_COOKIE = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;

// Session cookies may be split into chunks: name, name.0, name.1, ...
export const isAuthCookie = (name: string, key: string) => name === key || name.startsWith(`${key}.`);
