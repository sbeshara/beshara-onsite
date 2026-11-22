import Link from "next/link";
import { notFound } from "next/navigation";
import ProposalDoc from "@/components/ProposalDoc";
import { createClient } from "@/lib/supabase/server";
import { buildClientCopy } from "../../load";

// Exactly what the client will see when it's sent: no costs or margins.
export default async function PreviewPage({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  const copy = await buildClientCopy(await createClient(), id, eid);
  if (!copy) notFound();
  return (
    <div className="page">
      <div className="clientnote">
        <span>Client preview: this is what the client sees and signs. Costs and margins are never shown.</span>
        <Link className="linkbtn" href={`/projects/${id}/estimates/${eid}`}>Back to editor</Link>
      </div>
      <ProposalDoc copy={copy}>
        <div className="paper-sign">The client approves and signs here in OnSite once you send it.</div>
      </ProposalDoc>
    </div>
  );
}
