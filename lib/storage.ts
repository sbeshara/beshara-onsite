import type { SupabaseClient } from "@supabase/supabase-js";
import { FILES_BUCKET } from "./constants";

// Short-lived download links for private files, keyed by storage path.
export async function signUrls(supabase: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)];
  if (!unique.length) return {};
  const { data } = await supabase.storage.from(FILES_BUCKET).createSignedUrls(unique, 60 * 60);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
