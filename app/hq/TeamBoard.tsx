import type { PersonChecklist } from "@/lib/checklist";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// For the Principal Contractor and Admins: every PM's jobs for today.
export default function TeamBoard({
  lists,
  unassigned = [],
  site,
}: {
  lists: PersonChecklist[];
  unassigned?: { projectId: string; name: string; town: string }[];
  site: string;
}) {
  const total = lists.reduce((n, p) => n + p.items.length, 0);
  const done = lists.reduce((n, p) => n + p.items.filter((i) => i.done).length, 0);
  return (
    <section className="ck">
      <div className="ck-h">
        <h2>Team Check-Ins Today</h2>
        <span className={`ck-count ${done === total ? "all" : ""}`}>
          {done} of {total} Jobs Logged
        </span>
      </div>
      {unassigned.length > 0 && (
        <div className="ck-card ck-nobody" role="note">
          <div className="ck-card-h">
            <b>Nobody Assigned</b>
            <span className="ck-count">{unassigned.length}</span>
          </div>
          <p className="fine">
            In construction, but no one from Construction Management is on {unassigned.length === 1 ? "this job" : "these jobs"}, so no one is reminded
            about the daily log.
          </p>
          <ul className="ck-list compact">
            {unassigned.map((j) => (
              <li key={j.projectId}>
                <span className="ck-dot miss" aria-hidden="true">!</span>
                <div className="ck-main">
                  <a className="ck-name" href={`${site}/team?view=jobs&job=${j.projectId}`}>{j.name}</a>
                  <span className="ck-sub">Assign someone on Team &amp; Access</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {lists.length ? (
        <div className="ck-board">
          {lists.map((p) => {
            const d = p.items.filter((i) => i.done).length;
            return (
              <div key={p.userId} className="ck-card">
                <div className="ck-card-h">
                  <b>{p.name}</b>
                  <span className={`ck-count ${d === p.items.length ? "all" : ""}`}>
                    {d}/{p.items.length}
                  </span>
                </div>
                <ul className="ck-list compact">
                  {p.items.map((i) => (
                    <li key={i.projectId} className={i.done ? "done" : ""}>
                      <span className={`ck-dot ${i.done ? "on" : "miss"}`} aria-hidden="true">
                        {i.done ? "✓" : "!"}
                      </span>
                      <div className="ck-main">
                        <a className="ck-name" href={`${site}/projects/${i.projectId}`}>{i.name}</a>
                        <span className="ck-sub">
                          {i.done ? <>Daily log by {i.done.author || "the team"} · {time(i.done.at)}</> : i.linked ? "Missing" : "Missing · not linked to JobTread"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="fine">No Construction Management teammates are assigned to jobs yet. Assign them on Team &amp; Access.</p>
      )}
    </section>
  );
}
