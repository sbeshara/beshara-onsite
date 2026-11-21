import Link from "next/link";
import { notFound } from "next/navigation";
import { isLead } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import JobForm from "../../JobForm";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: job }, { data: customers }] = await Promise.all([
    supabase.from("projects").select("id, name, status, job_number, customer_id, job_type, town, address, notes, jobtread_job_id, customers(id, name, email, phone, customer_contacts(name, email, phone, is_primary))").eq("id", id).maybeSingle(),
    supabase.from("customers").select("id, name").order("name"),
  ]);
  if (!job) notFound();
  type C = { id: string; name: string; email: string | null; phone: string | null; customer_contacts: { name: string; email: string | null; phone: string | null; is_primary: boolean }[] };
  const customer = job.customers as unknown as C | null;
  const contact = customer?.customer_contacts.find((c) => c.is_primary) ?? customer?.customer_contacts[0];
  return (
    <div className="page">
      <div className="ogrid">
        <section className="ocard">
          <h2>Job details</h2>
          <JobForm job={job} customers={customers ?? []} />
        </section>
        <div style={{ display: "grid", gap: 16 }}>
          <section className="ocard">
            <h2>Customer</h2>
            {customer ? (
              <div style={{ display: "grid", gap: 4 }}>
                <Link className="textbtn" style={{ fontSize: 15 }} href={`/office/customers/${customer.id}`}>{customer.name}</Link>
                {contact && <span>{contact.name}</span>}
                {(contact?.email || customer.email) && <span className="fine">{contact?.email || customer.email}</span>}
                {(contact?.phone || customer.phone) && <span className="fine">{contact?.phone || customer.phone}</span>}
              </div>
            ) : (
              <p className="fine">No customer yet. Pick one in the job details.</p>
            )}
          </section>
          <section className="ocard">
            <h2>In OnSite</h2>
            <p className="fine">
              {isLead(job.status)
                ? "Leads stay internal. Once it's a job, invite the client from the project page to open their chats and files."
                : "The project's chats, files and client access."}
            </p>
            <Link className="btn ghost" href={`/projects/${job.id}`}>Open project</Link>
          </section>
          <section className="ocard">
            <h2>Estimates &amp; plans</h2>
            <p className="fine">Build proposals, change orders and additional scope, and take quantities off the plans.</p>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <Link className="btn ghost" href={`/office/jobs/${job.id}/estimates`}>Estimates</Link>
              <Link className="btn ghost" href={`/office/jobs/${job.id}/plans`}>Plans &amp; Takeoff</Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
