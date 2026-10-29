import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { BasecampError, finishConnect } from "@/lib/basecamp";
import { isAdminRole } from "@/lib/types";

// Basecamp sends the admin back here with a one-time code.
export async function GET(req: NextRequest) {
  const me = await getMe();
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/basecamp?${q}`, req.url));
    res.cookies.delete({ name: "bc_oauth_state", path: "/api/basecamp" });
    return res;
  };
  if (!isAdminRole(me.role)) return NextResponse.redirect(new URL("/", req.url));
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("bc_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) return back("error=state");
  try {
    await finishConnect(code, me.id);
  } catch (e) {
    console.error("Basecamp connect failed:", e instanceof BasecampError ? e.message : e);
    return back("error=signin");
  }
  return back("connected=1");
}
