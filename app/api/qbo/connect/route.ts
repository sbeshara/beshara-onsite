import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { authorizeUrl, qboConfigured } from "@/lib/qbo";

// "Connect QuickBooks": sends the Owner or Admin to Intuit to approve access.
export async function GET() {
  const me = await getMe();
  if (me.role !== "owner" && me.role !== "admin") return NextResponse.redirect(new URL("/office/invoicing", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  if (!qboConfigured()) return new NextResponse("QuickBooks isn't set up yet: add QBO_CLIENT_ID and QBO_CLIENT_SECRET in Vercel.", { status: 500 });
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("qbo_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/qbo" });
  return res;
}
