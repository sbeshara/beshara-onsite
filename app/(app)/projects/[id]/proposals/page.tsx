import Link from "next/link";
import ProposalDoc from "@/components/ProposalDoc";
import type { ClientCopy } from "@/lib/client-copy";
import { getMe } from "@/lib/auth";
import { projectViewer } from "@/lib/viewas";
import { createClient } from "@/lib/supabase/server";
import SignBox from "./SignBox";

export const metadata = { title: "Proposals · Beshara OnSite" };

type Doc = { id: string; seq: number; kind: string; name: string; status: string; sent_at: string; signed_at: string | null; signed_by_name: string | null; signature: string | null; declined_at: string | null; copy: ClientCopy };
const LABEL: Record<string, string> = { pending: "Waiting for your signature", approved: "Signed", denied: "Declined" };

// The client's proposals: review, sign or decline. Signed copies stay here.
export default async function ProposalsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc: want } = await searchParams;
  const me = await getMe();
  const v = await projectViewer(id);
  const { data } = await (await createClient()).rpc("client_proposals", { p_project: id });
  const docs = (data ?? []) as Doc[];
  const doc = docs.find((d) => d.id === want) ?? docs.find((d) => d.status === "pending") ?? docs[0];
  const canSign = me.role === "client" && !v.readOnly;
  return (
    <div className="page">
      {docs.length > 1 && (
        <div className="chips" role="tablist" aria-label="Proposals">
          {docs.map((d) => (
            <Link key={d.id} className="chip" href={`/projects/${id}/proposals?doc=${d.id}`} aria-pressed={d.id === doc?.id}>
              {d.kind} {d.copy.number} · {LABEL[d.status]}
            </Link>
          ))}
        </div>
      )}
      {doc ? (
        <ProposalDoc copy={doc.copy}>
          {doc.status === "approved" ? (
            <div className="signedbox" style={{ marginTop: 24 }}>
              {doc.signature && <img src={doc.signature} alt={`Signature of ${doc.signed_by_name}`} />}
              <div><b>Signed by {doc.signed_by_name}</b>{doc.signed_at && <small>{new Date(doc.signed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</small>}<small>Signed electronically in Beshara OnSite.</small></div>
            </div>
          ) : doc.status === "denied" ? (
            <div className="paper-sign">You declined this {doc.kind.toLowerCase()}{doc.declined_at ? ` on ${new Date(doc.declined_at).toLocaleDateString()}` : ""}. Your Beshara team will follow up.</div>
          ) : canSign ? (
            <SignBox projectId={id} estimateId={doc.id} kind={doc.kind} total={doc.copy.total} defaultName={me.full_name} />
          ) : (
            <div className="paper-sign">Waiting for the client to sign. {me.role !== "client" ? "Only the client can sign here." : ""}</div>
          )}
        </ProposalDoc>
      ) : (
        <p className="empty">No proposals yet. When Beshara Builders sends one, it shows up here to review and sign.</p>
      )}
    </div>
  );
}
