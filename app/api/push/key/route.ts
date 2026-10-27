import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

// The public half of the push key, needed by a phone or browser to sign up for notifications.
export async function GET() {
  const { publicKey } = await getVapidKeys(createAdminClient());
  return NextResponse.json({ publicKey });
}
