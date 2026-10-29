import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { BasecampError, connection, oauthReady, redirectUri } from "@/lib/basecamp";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/types";
import BasecampImport from "./BasecampImport";
import TellClients from "./TellClients";

export const metadata = { title: "Basecamp Import · Beshara OnSite" };

const ERRORS: Record<string, string> = {
  setup: "Basecamp isn't set up in Vercel yet. Follow the steps below first.",
  state: "That sign-in link expired. Click Connect Basecamp again.",
  signin: "Basecamp didn't finish signing in. Click Connect Basecamp again.",
};

export default async function BasecampPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/");
  const q = await searchParams;
  let conn = null;
  let connError = "";
  try {
    conn = await connection();
  } catch (e) {
    connError = e instanceof BasecampError ? e.message : "Couldn't reach Basecamp.";
  }
  const { data: projects } = await createAdminClient().from("projects").select("id, name, basecamp_project_id").order("name");

  return (
    <div className="page">
      <div className="page-h">
        <h1>Basecamp Import</h1>
        <p>
          Brings each Basecamp project&apos;s Message Board and Docs &amp; Files into OnSite. Every post becomes its own chat with its comments, in a
          From Basecamp section of the chat list. Posts the client could see in Basecamp go to client chats; everything else stays team only.
          Original names, dates and times are kept, and nobody gets notified.
        </p>
      </div>
      {q.error && <p className="err">{ERRORS[q.error] ?? ERRORS.signin}</p>}
      {connError && <p className="err">{connError}</p>}
      <BasecampImport
        connected={conn ? { account: conn.accountName, href: conn.href, who: conn.identityName, viaKey: !!process.env.BASECAMP_ACCESS_TOKEN } : null}
        canConnect={oauthReady()}
        redirectUri={redirectUri()}
        onsite={(projects ?? []).map((p) => ({ id: p.id as string, name: p.name as string, basecamp: (p.basecamp_project_id as string | null) ?? null }))}
      />
      {conn && <TellClients signer={me.full_name || "Beshara Builders"} />}
    </div>
  );
}
