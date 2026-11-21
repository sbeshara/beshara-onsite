import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CustomerForm from "./CustomerForm";

export const metadata = { title: "Customers · Beshara OnSite" };

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  customer_contacts: { name: string; email: string | null; is_primary: boolean }[];
  projects: { id: string; status: string }[];
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const { data } = await (await createClient())
    .from("customers")
    .select("id, name, email, phone, customer_contacts(name, email, is_primary), projects(id, status)")
    .order("name");
  let rows = (data ?? []) as unknown as Row[];
  if (q) rows = rows.filter((r) => [r.name, r.email, ...r.customer_contacts.map((c) => `${c.name} ${c.email ?? ""}`)].some((v) => v?.toLowerCase().includes(q)));
  return (
    <div className="page">
      <div className="page-h otools" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Customers</h1>
          <p>Practices and people you bid for, with their contacts. Contacts can be invited to their project in OnSite.</p>
        </div>
        <Link className="btn" href="/office/customers?new=1">+ New customer</Link>
      </div>
      {sp.new && (
        <section className="ocard" style={{ maxWidth: 760 }}>
          <h2>New customer</h2>
          <CustomerForm />
        </section>
      )}
      <form>
        <input className="osearch" name="q" defaultValue={sp.q ?? ""} placeholder="Search customers or contacts" aria-label="Search customers" />
      </form>
      <div className="box otable-wrap">
        {rows.length ? (
          <table className="otable">
            <thead><tr><th>Customer</th><th>Main contact</th><th className="r">Jobs</th><th className="r">Open leads</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const c = r.customer_contacts.find((x) => x.is_primary) ?? r.customer_contacts[0];
                return (
                  <tr key={r.id}>
                    <td><Link className="rowlink" href={`/office/customers/${r.id}`}>{r.name}</Link>{r.email && <small>{r.email}</small>}</td>
                    <td>{c ? <>{c.name}{c.email && <small>{c.email}</small>}</> : <span className="fine">None</span>}</td>
                    <td className="r">{r.projects.filter((p) => !["New Lead", "Estimating", "On Hold", "Closed Lost"].includes(p.status)).length}</td>
                    <td className="r">{r.projects.filter((p) => ["New Lead", "Estimating"].includes(p.status)).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">{q ? "No customers match that search." : "No customers yet. Add one, or import them from JobTread."}</p>
        )}
      </div>
    </div>
  );
}
