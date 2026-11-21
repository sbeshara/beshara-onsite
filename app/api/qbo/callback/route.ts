import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { connect } from "@/lib/qbo";

// Intuit sends the Owner or Admin back here after they approve.
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/office/invoicing?${q}`, req.url));
  const me = await getMe();
  if (me.role !== "owner" && me.role !== "admin") return back("qbo=denied");
  const p = req.nextUrl.searchParams;
  const state = req.cookies.get("qbo_state")?.value;
  if (!state || state !== p.get("state")) return back("qbo=expired");
  const code = p.get("code"), realm = p.get("realmId");
  if (!code || !realm) return back("qbo=cancelled");
  try {
    await connect(code, realm, me.id);
  } catch {
    return back("qbo=failed");
  }
  const res = back("qbo=connected");
  res.cookies.delete("qbo_state");
  return res;
}
