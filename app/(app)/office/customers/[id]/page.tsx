import Link from "next/link";
import { notFound } from "next/navigation";
import { statusClass } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";
import CustomerForm from "../CustomerForm";
import Contacts from "./Contacts";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("customers")
    .select("id, name, email, phone, address, notes, customer_contacts(id, name, title, email, phone, is_primary, profile_id), projects(id, name, status, job_number, town)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  type P = { id: string; name: string; status: string; job_number: string | null; town: string };
  const jobs = ((c.projects ?? []) as P[]).sort((a, b) => (b.job_number ?? "").localeCompare(a.job_number ?? ""));
  const contacts = [...(c.customer_contacts ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name));
  return (
    <div className="page">
      <div className="page-h">
        <Link className="textbtn" href="/office/customers">← Customers</Link>
        <h1 style={{ marginTop: 6 }}>{c.name}</h1>
      </div>
      <div className="ogrid">
        <div style={{ display: "grid", gap: 16 }}>
          <section className="ocard">
            <h2>Details</h2>
            <CustomerForm customer={c} />
          </section>
          <section className="ocard">
            <div className="sec-h" style={{ marginBottom: 0 }}><h2>Jobs</h2><Link className="linkbtn" href={`/office/jobs/new?customer=${c.id}`}>+ New lead</Link></div>
            {jobs.length ? (
              <div className="box rowlist">
                {jobs.map((j) => (
                  <Link key={j.id} href={`/projects/${j.id}`} className="rowitem" style={{ gridTemplateColumns: "minmax(0,1fr) auto", color: "inherit", textDecoration: "none" }}>
                    <span style={{ minWidth: 0 }}><b>{j.job_number ? `${j.job_number} · ` : ""}{j.name}</b><small>{j.town}</small></span>
                    <span className={statusClass(j.status)}>{j.status}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="fine">No jobs yet.</p>
            )}
          </section>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <Contacts customerId={c.id} contacts={contacts} canDelete={!jobs.length} />
        </div>
      </div>
    </div>
  );
}
