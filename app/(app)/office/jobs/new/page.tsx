import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import JobForm from "../../JobForm";

export const metadata = { title: "New Lead · Beshara OnSite" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer } = await searchParams;
  const { data } = await (await createClient()).from("customers").select("id, name").order("name");
  return (
    <div className="page">
      <div className="page-h">
        <Link className="textbtn" href="/office">← Jobs &amp; Leads</Link>
        <h1 style={{ marginTop: 6 }}>New Lead</h1>
        <p>Start a lead for a new or existing customer. You&apos;ll build the proposal from it.</p>
      </div>
      <div className="ocard" style={{ maxWidth: 760 }}>
        <JobForm customers={data ?? []} presetCustomer={customer} />
      </div>
    </div>
  );
}
