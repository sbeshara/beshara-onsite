import Link from "next/link";
import { docNumber, STATUS_LABEL } from "@/lib/estimates";
import { usd } from "@/lib/office";

export type DocRow = {
  id: string; seq: number; project_id: string; job_number: string | null; job_name?: string; kind: string; name: string; status: string;
  issued_on: string; signed_at: string | null; cost: number; price: number;
};

export const DOC_FILTERS = {
  all: { label: "All", statuses: ["draft", "pending", "approved", "denied"] },
  approved: { label: "Signed", statuses: ["approved"] },
  pending: { label: "Awaiting signature", statuses: ["pending"] },
  draft: { label: "Drafts", statuses: ["draft"] },
  denied: { label: "Declined", statuses: ["denied"] },
} as const;
export type DocFilter = keyof typeof DOC_FILTERS;
export const docFilter = (v: string | undefined): DocFilter => (v && v in DOC_FILTERS ? (v as DocFilter) : "all");

const PILL: Record<string, string> = { approved: "bc-done", pending: "warn", denied: "", draft: "" };
const day = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Proposals, change orders and additional scope with status filters and totals.
export default function DocumentsTable({ rows, filter, href, showJob }: { rows: DocRow[]; filter: DocFilter; href: (f: DocFilter) => string; showJob: boolean }) {
  const count = (f: DocFilter) => rows.filter((r) => (DOC_FILTERS[f].statuses as readonly string[]).includes(r.status));
  const list = count(filter).sort((a, b) => b.issued_on.localeCompare(a.issued_on));
  const total = list.reduce((s, r) => s + r.price, 0);
  return (
    <>
      <div className="chips" role="group" aria-label="Show">
        {(Object.keys(DOC_FILTERS) as DocFilter[]).map((f) => (
          <Link key={f} className="chip" href={href(f)} aria-pressed={f === filter}>
            {DOC_FILTERS[f].label} · {count(f).length}
          </Link>
        ))}
      </div>
      <p className="fine">{list.length} {list.length === 1 ? "document" : "documents"} · {usd(total)}</p>
      <div className="box otable-wrap">
        {list.length ? (
          <table className="otable">
            <thead><tr><th>Document</th>{showJob && <th>Job</th>}<th>Status</th><th>Issued</th><th className="r">Cost</th><th className="r">Price</th><th className="r">Margin</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const margin = r.price ? ((r.price - r.cost) / r.price) * 100 : 0;
                return (
                  <tr key={r.id} className={`doc-${r.status}`}>
                    <td><Link className="rowlink" href={`/projects/${r.project_id}/estimates/${r.id}`}>{r.name}</Link><small>{r.kind} {docNumber(r.job_number, r.seq)}</small></td>
                    {showJob && <td><Link className="rowlink" style={{ fontWeight: 500 }} href={`/projects/${r.project_id}/estimates`}>{r.job_number ? `${r.job_number} · ` : ""}{r.job_name}</Link></td>}
                    <td><span className={`pill ${PILL[r.status] ?? ""}`}>{STATUS_LABEL[r.status]}</span>{r.signed_at && r.status === "approved" && <small>{day(r.signed_at)}</small>}</td>
                    <td>{day(r.issued_on)}</td>
                    <td className="r">{usd(r.cost)}</td>
                    <td className="r"><b>{usd(r.price)}</b></td>
                    <td className={`r ${r.price && margin < 25 ? "margin-lo" : ""}`}>{r.price ? `${margin.toFixed(1)}%` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">Nothing here.</p>
        )}
      </div>
    </>
  );
}
