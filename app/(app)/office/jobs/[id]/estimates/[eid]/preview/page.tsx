import Link from "next/link";
import { notFound } from "next/navigation";
import { docNumber, itemQty, totals, type EstGroup, type EstItem } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { fmtQty } from "@/lib/takeoff";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "../../load";

// Exactly what the client will see: groups with their descriptions, items as
// each group is set to show them, the total and the payment schedule. No
// costs or margins.
export default async function PreviewPage({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  const supabase = await createClient();
  const [{ data: est }, { data: groups }, { data: items }, { data: steps }, { data: job }, { data: units }, measures] = await Promise.all([
    supabase.from("estimates").select("id, seq, kind, name, status, intro, terms, issued_on").eq("id", eid).maybeSingle(),
    supabase.from("estimate_groups").select("id, name, description, client_view, display_qty, display_unit, position").eq("estimate_id", eid).order("position"),
    supabase.from("estimate_items").select("id, group_id, name, description, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position").eq("estimate_id", eid).order("position"),
    supabase.from("estimate_payment_steps").select("name, percent").eq("estimate_id", eid).order("position"),
    supabase.from("projects").select("job_number, name, town, address, customers(name, customer_contacts(name, is_primary))").eq("id", id).maybeSingle(),
    supabase.from("units").select("id, abbr"),
    jobMeasures(supabase, id),
  ]);
  if (!est || !job) notFound();
  const abbr = (uid: number | null) => units?.find((u) => u.id === uid)?.abbr ?? "";
  const rows = ((items ?? []) as EstItem[]).map((i) => ({ ...i, q: itemQty(i, measures.map) }));
  const t = totals(rows.map((r) => ({ q: r.q, c: 0, p: Number(r.unit_price) })));
  const customer = job.customers as unknown as { name: string; customer_contacts: { name: string; is_primary: boolean }[] } | null;
  const contact = customer?.customer_contacts.find((c) => c.is_primary) ?? customer?.customer_contacts[0];
  return (
    <div className="page">
      <div className="clientnote">
        <span>Client preview: this is what the client sees. Costs and margins are never shown.</span>
        <Link className="linkbtn" href={`/office/jobs/${id}/estimates/${eid}`}>Back to editor</Link>
      </div>
      <article className="paper">
        <div className="paper-lh">
          <span className="logo paper-logo" role="img" aria-label="Beshara Builders" />
          <div className="fine" style={{ textAlign: "right" }}>Beshara Builders<br />{est.kind} {docNumber(job.job_number, est.seq)}<br />Issued {new Date(est.issued_on + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
        </div>
        <h1>{est.name}</h1>
        <div className="paper-to">
          <div><span>Prepared for</span>{contact?.name ?? customer?.name ?? ""}{contact && customer ? <><br />{customer.name}</> : null}</div>
          <div><span>Project</span>{job.name}{job.address || job.town ? <><br />{job.address || job.town}</> : null}</div>
        </div>
        {est.intro && <p className="paper-intro">{est.intro}</p>}
        {((groups ?? []) as EstGroup[]).map((g) => {
          const gi = rows.filter((r) => r.group_id === g.id);
          const gp = gi.reduce((s, r) => s + r.q * Number(r.unit_price), 0);
          return (
            <section key={g.id} className="pblock">
              <div className="pblock-h">
                <h3>{g.name}</h3>
                <div className="gp">
                  <b>{usd(gp, true)}</b>
                  {g.client_view === "total" && <small>{g.display_unit && g.display_qty ? `${fmtQty(Number(g.display_qty))} ${g.display_unit} × ${usd(gp / Number(g.display_qty), true)}/${g.display_unit}` : "Lump sum"}</small>}
                </div>
              </div>
              {g.description && <p className="pdesc">{g.description}</p>}
              {g.client_view !== "total" && gi.length > 0 && (
                <div className="otable-wrap">
                  <table className="pitems">
                    <thead><tr><th>Item</th><th className="r">Quantity</th>{g.client_view === "items" && <><th className="r">Unit price</th><th className="r">Total</th></>}</tr></thead>
                    <tbody>
                      {gi.map((r) => (
                        <tr key={r.id}>
                          <td><b>{r.name}</b>{r.description && <small>{r.description}</small>}</td>
                          <td className="r">{abbr(r.unit_id) === "LS" ? "Lump sum" : `${fmtQty(r.q)} ${abbr(r.unit_id)}`}</td>
                          {g.client_view === "items" && <><td className="r">{usd(Number(r.unit_price), true)}{abbr(r.unit_id) !== "LS" && <small>/ {abbr(r.unit_id)}</small>}</td><td className="r"><b>{usd(r.q * Number(r.unit_price), true)}</b></td></>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
        <div className="paper-total"><span>Total</span><b>{usd(t.price, true)}</b></div>
        {!!steps?.length && (
          <>
            <h2>Payment schedule</h2>
            <table className="pitems"><tbody>{steps.map((s, i) => <tr key={i}><td>{s.name}</td><td className="r">{Number(s.percent)}%</td><td className="r"><b>{usd((t.price * Number(s.percent)) / 100, true)}</b></td></tr>)}</tbody></table>
          </>
        )}
        {est.terms && (<><h2>Terms</h2><p className="paper-terms">{est.terms}</p></>)}
        <div className="paper-sign">Approve and sign: the client signs here online once you send it.</div>
      </article>
    </div>
  );
}
