import "server-only";
import { cache } from "react";
import { getMe } from "./auth";
import { createAdminClient } from "./supabase/admin";
import { PRECON_KEY, SENIOR_KEY } from "./senior";
import type { Profile } from "./types";

// What the signed-in person can do in the office tools (estimates, catalog,
// customers, invoicing). Mirrors sees_numbers() in the database, which is what
// actually enforces it.
export type Access = {
  me: Profile;
  senior: boolean;
  precon: boolean;
  // Owner, Admin, Senior PM, Preconstruction Manager: every job and lead, every
  // number, customers and the catalog.
  seesNumbers: boolean;
  label: string;
};

export const getAccess = cache(async (): Promise<Access> => {
  const me = await getMe();
  let senior = false;
  let precon = false;
  if (me.role === "construction") {
    const { data } = await createAdminClient().from("app_settings").select("key").in("key", [SENIOR_KEY(me.id), PRECON_KEY(me.id)]);
    const keys = new Set((data ?? []).map((r) => String(r.key)));
    senior = keys.has(SENIOR_KEY(me.id));
    precon = keys.has(PRECON_KEY(me.id));
  }
  const seesNumbers = me.role === "owner" || me.role === "admin" || senior || precon;
  const label =
    me.role === "owner" ? "Owner" : me.role === "admin" ? "Admin" : precon ? "Preconstruction Manager" : senior ? "Senior PM" : me.role === "construction" ? "PM" : "Client";
  return { me, senior, precon, seesNumbers, label };
});
