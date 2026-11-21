import Link from "next/link";
import { JOB_STATUSES, LEAD_STATUSES } from "@/lib/constants";
import { statusClass } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Jobs & Leads · Beshara OnSite" };

const VIEWS = {
  active: { label: "Active jobs", statuses: ["Approved", "Preconstruction", "Permitting", "Construction"] },
  leads: { label: "Leads", statuses: ["New Lead", "Estimating", "On Hold"] },
  complete: { label: "Complete", statuses: ["Complete"] },
  lost: { label: "Closed lost", statuses: ["Closed Lost"] },
  all: { label: "All", statuses: [...LEAD_STATUSES, ...JOB_STATUSES] as string[] },
} as const;
type View = keyof typeof VIEWS;

type Row = {
  id: string;
  name: string;
  town: string;
  status: string;
  job_number: string | null;
  job_type: string | null;
  status_changed_at: string;
  customers: { id: string; name: string } | null;
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const sp = await searchParams;
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "active";
  const q = (sp.q ?? "").trim();
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, town, status, job_number, job_type, status_changed_at, customers(id, name)")
    .in("status", VIEWS[view].statuses as unknown as string[])
    .order("job_number", { ascending: false, nullsFirst: false })
    .limit(500);
  let rows = (data ?? []) as unknown as Row[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => [r.name, r.town, r.job_number, r.customers?.name].some((v) => v?.toLowerCase().includes(needle)));
  }
  const { data: counts } = await supabase.from("projects").select("status");
  const count = (v: View) => (counts ?? []).filter((r) => (VIEWS[v].statuses as readonly string[]).includes(r.status)).length;
  const href = (v: View) => `/office?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="page">
      <div className="page-h otools" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Jobs &amp; Leads</h1>
          <p>Every lead and job, with its status. A job shows up in clients&apos; OnSite once you invite them from the project.</p>
        </div>
        <Link className="btn" href="/office/jobs/new">+ New lead</Link>
      </div>
      <div className="otools">
        <div className="chips" role="group" aria-label="Which jobs">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <Link key={v} className="chip" href={href(v)} aria-pressed={v === view}>
              {VIEWS[v].label} · {count(v)}
            </Link>
          ))}
        </div>
        <form>
          <input type="hidden" name="view" value={view} />
          <input className="osearch" name="q" defaultValue={q} placeholder="Search by name, customer, number or town" aria-label="Search jobs" />
        </form>
      </div>
      <div className="box otable-wrap">
        {rows.length ? (
          <table className="otable">
            <thead>
              <tr><th>Job</th><th>Customer</th><th>Status</th><th>Type</th><th>Town</th><th className="r">Since</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="rowlink" href={`/office/jobs/${r.id}`}>{r.job_number ? `${r.job_number} · ` : ""}{r.name}</Link>
                  </td>
                  <td>{r.customers ? <Link className="rowlink" style={{ fontWeight: 500 }} href={`/office/customers/${r.customers.id}`}>{r.customers.name}</Link> : <span className="fine">None</span>}</td>
                  <td><span className={statusClass(r.status)}>{r.status}</span></td>
                  <td>{r.job_type ?? ""}</td>
                  <td>{r.town}</td>
                  <td className="r fine">{new Date(r.status_changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">{q ? "Nothing matches that search." : "Nothing here yet."}</p>
        )}
      </div>
    </div>
  );
}
