import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { BasecampError, bcAll, connection, type BcProject } from "@/lib/basecamp";
import { isAdminRole } from "@/lib/types";

export const maxDuration = 60;

// Every Basecamp project the connected person can see, active and archived.
export async function GET() {
  const me = await getMe();
  if (!isAdminRole(me.role)) return NextResponse.json({ error: "Only the Principal Contractor or Admin can import from Basecamp." }, { status: 403 });
  try {
    const conn = await connection();
    if (!conn) return NextResponse.json({ error: "Basecamp isn't connected." }, { status: 400 });
    const [active, archived] = await Promise.all([bcAll<BcProject>(conn, "/projects.json"), bcAll<BcProject>(conn, "/projects.json?status=archived")]);
    const projects = [...active, ...archived].map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      description: p.description,
      kind: p.purpose ?? "topic",
      updated_at: p.updated_at,
      app_url: p.app_url,
    }));
    return NextResponse.json({ projects });
  } catch (e) {
    console.error("Basecamp project list failed:", e);
    return NextResponse.json({ error: e instanceof BasecampError ? e.message : "Couldn't reach Basecamp. Try again." }, { status: 502 });
  }
}
