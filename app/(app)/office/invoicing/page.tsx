import Link from "next/link";
import { getAccess } from "@/lib/access";
import { billing, INVOICE_LABEL } from "@/lib/billing";
import { docNumber } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { connection, qboConfigured } from "@/lib/qbo";
import { createClient } from "@/lib/supabase/server";
import { InvoiceButton, QboControls } from "../InvoiceBits";

export const metadata = { title: "Invoicing · Beshara OnSite" };
export const dynamic = "force-dynamic";
const day = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const NOTE: Record<string, string> = { connected: "QuickBooks Online is connected.", denied: "Only the Owner or Admin can connect QuickBooks.", expired: "That took too long. Try connecting again.", cancelled: "QuickBooks wasn't connected.", failed: "QuickBooks didn't connect. Try again." };

export default async function InvoicingPage({ searchParams }: { searchParams: Promise<{ qbo?: string }> }) {
  const { qbo } = await searchParams;
  const { me } = await getAccess();
  const canSend = me.role === "owner" || me.role === "admin";
  const supabase = await createClient();
  const [{ steps, invoices }, { data: jobs }, conn] = await Promise.all([
    billing(supabase),
    supabase.from("projects").select("id, name, job_number, customers(name, email, customer_contacts(email, is_primary))"),
    connection(),
  ]);
  type J = { id: string; name: string; job_number: string | null; customers: { name: string; email: string | null; customer_contacts: { email: string | null; is_primary: boolean }[] } | null };
  const job = new Map(((jobs ?? []) as unknown as J[]).map((j) => [j.id, j]));
  const emailOf = (pid: string) => { const c = job.get(pid)?.customers; return c?.customer_contacts.find((x) => x.is_primary)?.email ?? c?.customer_contacts.find((x) => x.email)?.email ?? c?.email ?? ""; };
  const ready = steps.filter((s) => s.reached_at && !s.invoice);
  const open = invoices.filter((i) => i.status === "sent" || i.status === "partial");
  const done = invoices.filter((i) => i.status === "paid").slice(0, 25);
  const today = Date.now();
  return (
    <div className="page">
      <div className="page-h">
        <h1>Invoicing</h1>
        <p>Invoices are made here from each signed proposal&apos;s payment steps, created in QuickBooks Online and emailed by QuickBooks. Payments recorded in QuickBooks come back here with the date and method, so nobody needs a QuickBooks login.</p>
      </div>
      {qbo && NOTE[qbo] && <p className={qbo === "connected" ? "ok" : "err"} role="status">{NOTE[qbo]}</p>}
      <section className="ocard">
        <div className="sec-h" style={{ marginBottom: 0 }}>
          <h2>QuickBooks Online</h2>
          <QboControls connected={!!conn} canManage={canSend} />
        </div>
        {!qboConfigured() ? (
          <p className="fine">Not set up yet: QuickBooks needs an Intuit developer app (its client ID and secret go in Vercel). See SETUP-QUICKBOOKS.md in the repo.</p>
        ) : conn ? (
          <p className="fine">Connected to <b style={{ color: "var(--ink)" }}>{conn.company_name ?? "your company"}</b> since {day(conn.connected_at)}. {conn.last_payment_check ? `Payments last checked ${new Date(conn.last_payment_check).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.` : ""} Payments also update on their own as QuickBooks records them.</p>
        ) : (
          <p className="fine">Not connected. {canSend ? "Connect it to send invoices." : "Ask the Owner or Admin to connect it."}</p>
        )}
      </section>
      <div className="kvrow">
        <div><span>Ready to invoice</span><b>{usd(ready.reduce((s, x) => s + x.amount, 0))}</b><small>{ready.length} steps</small></div>
        <div><span>Open invoices</span><b>{usd(open.reduce((s, i) => s + Number(i.amount) - Number(i.paid_total), 0))}</b><small>{open.length} unpaid</small></div>
        <div><span>Paid, last 30 days</span><b>{usd(invoices.filter((i) => i.status !== "void").flatMap((i) => i.invoice_payments).filter((p) => today - new Date(p.paid_on).getTime() < 30 * 864e5).reduce((s, p) => s + Number(p.amount), 0))}</b></div>
      </div>
      <section className="ocard">
        <h2>Ready to invoice</h2>
        {ready.length ? (
          <div className="box rowlist">
            {ready.map((s) => {
              const j = job.get(s.estimate.project_id);
              return (
                <div key={s.id} className="rowitem" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                  <div style={{ minWidth: 0 }}><b>{j?.customers?.name ?? j?.name}</b><small>{s.name} · {s.percent}% of {s.estimate.kind} {docNumber(j?.job_number, s.estimate.seq)}</small></div>
                  <b className="num">{usd(s.amount, true)}</b>
                  <InvoiceButton projectId={s.estimate.project_id} estimateId={s.estimate.id} stepId={s.id} amount={s.amount} description={`${s.name} (${s.percent}% of ${s.estimate.kind} ${docNumber(j?.job_number, s.estimate.seq)})`} email={emailOf(s.estimate.project_id)} canSend={canSend} />
                </div>
              );
            })}
          </div>
        ) : <p className="fine">Nothing waiting. Mark a payment step reached on a job&apos;s Invoicing tab when the work is done.</p>}
      </section>
      <section className="ocard">
        <h2>Invoices</h2>
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Sent</th><th>Paid on</th><th>Method</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {[...open, ...done, ...invoices.filter((i) => i.status === "draft")].map((i) => {
                const j = job.get(i.project_id), last = i.invoice_payments.at(-1);
                return (
                  <tr key={i.id}>
                    <td><Link className="rowlink" href={`/projects/${i.project_id}/invoicing`}>{docNumber(j?.job_number, i.seq)}</Link><small>{i.description}</small></td>
                    <td>{j?.customers?.name ?? j?.name}</td>
                    <td><span className={`pill ${i.status === "paid" ? "bc-done" : i.status === "draft" ? "" : "warn"}`}>{INVOICE_LABEL[i.status]}</span>{i.qbo_error && <small className="err">{i.qbo_error}</small>}</td>
                    <td>{i.sent_at ? day(i.sent_at) : ""}{i.sent_at && i.status !== "paid" && <small>{Math.floor((today - new Date(i.sent_at).getTime()) / 864e5)} days out</small>}</td>
                    <td>{last ? day(last.paid_on) : ""}</td>
                    <td>{last?.method ?? ""}</td>
                    <td className="r">{usd(Number(i.amount), true)}</td>
                    <td className="r"><b>{Number(i.amount) - Number(i.paid_total) > 0.005 ? usd(Number(i.amount) - Number(i.paid_total), true) : "—"}</b></td>
                  </tr>
                );
              })}
              {!invoices.length && <tr><td colSpan={8} className="fine">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
