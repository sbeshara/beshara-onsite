import type { CheckItem } from "@/lib/checklist";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// A PM's Daily Check-In: each active job is done once JobTread has today's
// daily log for it. There's nothing to tick; the log is the check-in.
// Logs are due by the end of the day: until 5 PM an unlogged job shows as
// "Due today", after 5 PM as "Missing".
export default function Checklist({ items, site, late }: { items: CheckItem[]; site: string; late: boolean }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="ck">
      <div className="ck-h">
        <div>
          <h2>Daily Check-In</h2>
          <p className="ck-lead">Write today&apos;s daily log in JobTread for every active job, even the quiet ones.</p>
        </div>
        <span className={`ck-count ${done === items.length ? "all" : late ? "" : "due"}`}>
          {done} of {items.length} Logged
        </span>
      </div>
      <ul className="ck-list">
        {items.map((i) => (
          <li key={i.projectId} className={i.done ? "done" : late ? "" : "due"}>
            <span className={`ck-dot ${i.done ? "on" : late ? "miss" : "due"}`} aria-hidden="true">
              {i.done ? "✓" : late ? "!" : ""}
            </span>
            <div className="ck-main">
              <a className="ck-name" href={`${site}/projects/${i.projectId}`}>
                <span className={`pdot ph${i.phase}`} aria-hidden="true" /> {i.name}
              </a>
              <span className="ck-sub">
                {i.done ? (
                  <>Daily log by {i.done.author || "the team"} at {time(i.done.at)}</>
                ) : i.linked ? (
                  late ? "Missing today's daily log" : "Today's daily log is due by the end of the day"
                ) : (
                  `${late ? "Missing" : "Due today"} · not linked to JobTread, so its daily log can't be found. Ask Julia to link it.`
                )}
              </span>
            </div>
            {!i.done && <span className={late ? "ck-missing" : "ck-due"}>{late ? "Missing" : "Due Today"}</span>}
          </li>
        ))}
      </ul>
      <p className="fine">
        Each job checks off on its own once its JobTread daily log for today is in. Only jobs in construction are listed. Logs are due by the end of
        the day; at 5 PM you get one reminder for any still missing.
      </p>
    </section>
  );
}
