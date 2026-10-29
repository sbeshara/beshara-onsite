import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { BasecampError, connection } from "@/lib/basecamp";
import { clientsToMove } from "@/lib/basecamp-announce";
import { isAdminRole } from "@/lib/types";

export const maxDuration = 120;

// The Basecamp clients on each imported project, and whether they're in OnSite yet.
export async function GET() {
  const me = await getMe();
  if (!isAdminRole(me.role)) return NextResponse.json({ error: "Only the Principal Contractor or Admin can do that." }, { status: 403 });
  try {
    const conn = await connection();
    if (!conn) return NextResponse.json({ error: "Basecamp isn't connected." }, { status: 400 });
    return NextResponse.json({ projects: await clientsToMove(conn) });
  } catch (e) {
    console.error("Basecamp client list failed:", e);
    return NextResponse.json({ error: e instanceof BasecampError ? e.message : "Couldn't reach Basecamp. Try again." }, { status: 502 });
  }
}
