"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { disconnect } from "@/lib/basecamp";
import { isAdminRole } from "@/lib/types";

export async function disconnectBasecamp() {
  const me = await getMe();
  if (!isAdminRole(me.role)) return;
  await disconnect();
  revalidatePath("/basecamp");
}

