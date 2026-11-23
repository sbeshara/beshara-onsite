import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import type { ClientCopy } from "@/lib/client-copy";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// A proposal as the client reads it (also the office's preview).
export default function ProposalDoc({ copy, children }: { copy: ClientCopy; children?: React.ReactNode }) {
  return (
    <article className="paper">
      <div className="paper-lh">
        <span className="logo paper-logo" role="img" aria-label="Beshara Builders" />
        <div className="fine" style={{ textAlign: "right" }}>
          Beshara Builders<br />{copy.kind} {copy.number}<br />Issued {new Date(copy.issued_on + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </div>
      </div>
      <h1>{copy.name}</h1>
      <div className="paper-to">
        <div><span>Prepared for</span>{copy.prepared_for.map((l, i) => <div key={i}>{l}</div>)}</div>
        <div><span>Project</span>{copy.project.map((l, i) => <div key={i}>{l}</div>)}</div>
      </div>
      {copy.intro && <div className="paper-intro md"><ReactMarkdown remarkPlugins={[remarkBreaks]}>{copy.intro}</ReactMarkdown></div>}
      {copy.groups.map((g, gi) => {
        const hasQty = g.items.some((it) => it.qty !== undefined);
        const hasUnit = g.items.some((it) => it.unit_price !== undefined);
        const hasTotal = g.items.some((it) => it.total !== undefined);
        return (
        <section key={gi} className="pblock">
          <div className="pblock-h">
            <h3>{g.name}</h3>
            {!g.hide_total && <div className="gp"><b>{usd(g.total)}</b>{g.display && <small>{g.display}</small>}</div>}
          </div>
          {g.description && <p className="pdesc">{g.description}</p>}
          {g.items.length > 0 && (
            <div className="otable-wrap">
              <table className="pitems">
                <thead><tr><th>Item</th>{hasQty && <th className="r">Quantity</th>}{hasUnit && <th className="r">Unit price</th>}{hasTotal && <th className="r">Total</th>}</tr></thead>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={i}>
                      <td><b>{it.name}</b>{it.description && <small>{it.description}</small>}</td>
                      {hasQty && <td className="r">{it.qty}</td>}
                      {hasUnit && <td className="r">{usd(it.unit_price ?? 0)}{it.unit && it.unit !== "LS" && <small>/ {it.unit}</small>}</td>}
                      {hasTotal && <td className="r"><b>{usd(it.total ?? 0)}</b></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        );
      })}
      <div className="paper-total"><span>Total</span><b>{usd(copy.total)}</b></div>
      {copy.steps.length > 0 && (
        <>
          <h2>Payment schedule</h2>
          <table className="pitems">
            <tbody>{copy.steps.map((s, i) => <tr key={i}><td>{s.name}</td><td className="r">{s.percent}%</td><td className="r"><b>{usd(s.amount)}</b></td></tr>)}</tbody>
          </table>
        </>
      )}
      {copy.terms && <div className="paper-terms md">{/^\s*#/.test(copy.terms) ? null : <h2>Terms</h2>}<ReactMarkdown remarkPlugins={[remarkBreaks]}>{copy.terms}</ReactMarkdown></div>}
      {children}
    </article>
  );
}
