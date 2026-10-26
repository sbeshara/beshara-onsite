import "server-only";
import { createClient } from "@supabase/supabase-js";

// Full-access client for invites and role changes. Only use it after checking
// that the signed-in person is allowed to do the thing.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
