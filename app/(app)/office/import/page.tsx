import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { planDocuments, planImport, planInvoices, type DocPlan, type ImportPlan, type InvoicePlan } from "@/lib/jobtread-import";
import RunImport, { RunDocuments, RunInvoices } from "./RunImport";

export const metadata = { title: "JobTread Import · Beshara OnSite" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ImportPage() {
  const { me } = await getAccess();
  if (me.role !== "owner" && me.role !== "admin") redirect("/office");
  let plan: ImportPlan | null = null;
  let docs: DocPlan | null = null;
  let invs: InvoicePlan | null = null;
  let error = "";
  try {
    [plan, docs, invs] = await Promise.all([planImport(), planDocuments(), planInvoices()]);
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
          {docs && (
            <section className="ocard">
              <h2>2. Proposals, change orders and templates</h2>
              <p>
                {docs.templates} document templates (with their intros and terms), {docs.approved} signed documents and {docs.pending} sent but not signed.
                {docs.imported ? ` ${docs.imported} already imported.` : ""}
              </p>
              <p className="fine">
                Run this after step 1. Signed documents arrive signed and locked, keeping their JobTread number (e.g. 2714-9), groups, items and prices.
                Each job&apos;s JobTread &quot;Payment Schedule&quot; becomes its main proposal&apos;s payment steps when the percentages add up to 100%.
                Documents sent but not signed in JobTread arrive as drafts you can send from OnSite.
              </p>
              <RunDocuments />
            </section>
          )}
          {invs && (
            <section className="ocard">
              <h2>3. Invoices and payments</h2>
              <p>
                {invs.invoices} invoices totaling {invs.total.toLocaleString("en-US", { style: "currency", currency: "USD" })}, with {invs.paid.toLocaleString("en-US", { style: "currency", currency: "USD" })} paid.
                {invs.imported ? ` ${invs.imported} already imported.` : ""}
              </p>
              <p className="fine">
                Run this after step 2. Invoices on the duplicate &quot;Internal - Invoices&quot; jobs land on their real job, next to the older invoices made on
                the real job. Each keeps its payments (date and amount) and its QuickBooks link, so payments keep coming in once QuickBooks is connected.
                Invoices for a step like &quot;Permits 10%&quot; mark that payment step invoiced; others show under Other invoices on the job.
              </p>
              <RunInvoices />
            </section>
          )}
        </>
      )}
    </div>
  );
}
