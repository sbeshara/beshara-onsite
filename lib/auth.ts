import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

// The signed-in person's profile, loaded once per request.
export const getMe = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.from("profiles").select("id, email, full_name, role, title").eq("id", user.id).single();
  if (!data) redirect("/login");
  return data as Profile;
});
