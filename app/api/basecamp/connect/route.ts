import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { authorizeUrl, oauthReady } from "@/lib/basecamp";
import { isAdminRole } from "@/lib/types";

// Sends an admin to Basecamp to approve OnSite reading their account.
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!isAdminRole(me.role)) return NextResponse.redirect(new URL("/", req.url));
  if (!oauthReady()) return NextResponse.redirect(new URL("/basecamp?error=setup", req.url));
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("bc_oauth_state", state, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/basecamp", maxAge: 600 });
  return res;
}
