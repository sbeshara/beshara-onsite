import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getMe } from "./auth";
import { isAdminRole } from "./types";

export const PREVIEW_COOKIE = "onsite_preview";

// The project the Principal Contractor or Admin is previewing as its client, if any.
export const getPreview = cache(async (): Promise<string | null> => {
  const me = await getMe();
  if (!isAdminRole(me.role)) return null;
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value;
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
});
