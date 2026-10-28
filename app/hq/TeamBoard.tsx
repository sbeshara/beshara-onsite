import type { PersonChecklist } from "@/lib/checklist";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// For the Principal Contractor and Admins: every PM's jobs for today.
export default function TeamBoard({ lists, site }: { lists: PersonChecklist[]; site: string }) {
  const total = lists.reduce((n, p) => n + p.items.length, 0);
  const done = lists.reduce((n, p) => n + p.items.filter((i) => i.done).length, 0);
  return (
    <section className="ck">
      <div className="ck-h">
        <h2>Team Check-Ins Today</h2>
        <span className={`ck-count ${done === total ? "all" : ""}`}>
          {done} of {total} Jobs Checked
        </span>
      </div>
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
                      <span className={`ck-box ${i.done ? "on" : ""}`} aria-hidden="true">
                        {i.done ? "✓" : ""}
                      </span>
                      <div className="ck-main">
                        <a className="ck-name" href={`${site}/projects/${i.projectId}`}>{i.name}</a>
                        <span className="ck-sub">
                          {i.done?.by === "log" && <>Daily log by {i.done.author || "the team"} · {time(i.done.at)}</>}
                          {i.done?.by === "manual" && <>Checked by hand · {time(i.done.at)}{i.done.note ? ` · “${i.done.note}”` : ""}</>}
                          {!i.done && "Open"}
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
