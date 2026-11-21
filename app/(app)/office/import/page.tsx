import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { planImport, type ImportPlan } from "@/lib/jobtread-import";
import RunImport from "./RunImport";

export const metadata = { title: "JobTread Import · Beshara OnSite" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const { me } = await getAccess();
  if (me.role !== "owner" && me.role !== "admin") redirect("/office");
  let plan: ImportPlan | null = null;
  let error = "";
  try {
    plan = await planImport();
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="page">
      <div className="page-h">
        <h1>JobTread Import</h1>
        <p>
          Copies your catalog, customers and jobs from JobTread into OnSite. Nothing in JobTread changes. You can run it again any time: records
          that were imported before are updated, not duplicated.
        </p>
      </div>
      {error && <p className="err" role="alert">Couldn&apos;t read JobTread: {error}</p>}
      {plan && (
        <>
          <div className="row3">
            <section className="ocard">
              <h2>Catalog</h2>
              <p>{plan.catalog.groups} cost groups and {plan.catalog.items} cost items</p>
              <p className="fine">{plan.catalog.newGroups + plan.catalog.newItems} new, the rest update.</p>
            </section>
            <section className="ocard">
              <h2>Customers</h2>
              <p>{plan.customers.total} customers with {plan.customers.contacts} contacts</p>
              <p className="fine">{plan.customers.new} new.</p>
            </section>
            <section className="ocard">
              <h2>Jobs</h2>
              <p>{plan.jobs.total} jobs and leads</p>
              <p className="fine">{plan.jobs.new} new, {plan.jobs.updated} already in OnSite (their status and details update; their OnSite name stays).</p>
            </section>
          </div>
          <section className="ocard">
            <h2>Status after import</h2>
            <div className="chips">
              {Object.entries(plan.jobs.byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => <span key={s} className="chip">{s} · {n}</span>)}
            </div>
            <p className="fine">&quot;Preconstruction Services Complete&quot; becomes Complete. Jobs with no status become New Lead, or Complete if closed in JobTread.</p>
          </section>
          <section className="ocard">
            <h2>Duplicate invoice jobs ({plan.merges.length})</h2>
            <p className="fine">
              These &quot;Internal - Invoices&quot; jobs only existed to bill a percentage payment plan. They won&apos;t become jobs in OnSite; each is
              attached to the real job so its payment schedule and invoices can come over with it.
            </p>
            <div className="box otable-wrap">
              <table className="otable">
                <thead><tr><th>Invoice job</th><th>Attaches to</th><th /></tr></thead>
                <tbody>
                  {plan.merges.map((m) => (
                    <tr key={m.invoiceJob}>
                      <td>{m.invoiceJob}</td>
                      <td>{m.realJob ?? <span className="err">No match</span>}</td>
                      <td>{m.note && <span className="fine">{m.note}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <RunImport />
        </>
      )}
    </div>
  );
}
