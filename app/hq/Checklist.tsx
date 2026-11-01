import type { CheckItem } from "@/lib/checklist";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// A PM's Daily Check-In: each active job is done once JobTread has today's
// daily log for it. There's nothing to tick; the log is the check-in.
export default function Checklist({ items, site }: { items: CheckItem[]; site: string }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="ck">
      <div className="ck-h">
        <div>
          <h2>Daily Check-In</h2>
          <p className="ck-lead">Write today&apos;s daily log in JobTread for every active job, even the quiet ones.</p>
        </div>
        <span className={`ck-count ${done === items.length ? "all" : ""}`}>
          {done} of {items.length} Logged
        </span>
      </div>
      <ul className="ck-list">
        {items.map((i) => (
          <li key={i.projectId} className={i.done ? "done" : ""}>
            <span className={`ck-dot ${i.done ? "on" : "miss"}`} aria-hidden="true">
              {i.done ? "✓" : "!"}
            </span>
            <div className="ck-main">
              <a className="ck-name" href={`${site}/projects/${i.projectId}`}>
                <span className={`pdot ph${i.phase}`} aria-hidden="true" /> {i.name}
              </a>
              <span className="ck-sub">
                {i.done ? (
                  <>Daily log by {i.done.author || "the team"} at {time(i.done.at)}</>
                ) : i.linked ? (
                  "Missing today's daily log"
                ) : (
                  "Missing · not linked to JobTread, so its daily log can't be found. Ask Julia to link it."
                )}
              </span>
            </div>
            {!i.done && <span className="ck-missing">Missing</span>}
          </li>
        ))}
      </ul>
      <p className="fine">
        Each job checks off on its own once its JobTread daily log for today is in. Only jobs in construction are listed; reminders go out at 10 AM and
        5 PM for any still missing.
      </p>
    </section>
  );
}
