import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieOptions } from "./cookies";

// Acts as the signed-in person, so row-level security decides what they see.
export async function createClient() {
  const cookieStore = await cookies();
  const host = (await headers()).get("host");
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(host),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; the middleware refreshes the session instead.
          }
        },
      },
    },
  );
}
