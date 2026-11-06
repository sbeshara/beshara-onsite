"use client";

import { useEffect, useState, useTransition } from "react";
import { setDailyLogOwner } from "./actions";

type Props = {
  projectId: string;
  owner: string;
  how: "chosen" | "only" | "logs" | "guess";
  members: { id: string; name: string }[];
};

const HOW: Record<Props["how"], string> = {
  chosen: "Chosen by an admin.",
  only: "The only Construction Management person on this job.",
  logs: "Picked automatically: they've written most of this job's JobTread daily logs lately.",
  guess: "Picked automatically (no recent daily logs to go by). Choose the right person.",
};

// Who writes this job's daily log: the only person it shows up for on the
// daily checklist and in the reminder emails.
export default function DailyLogPicker({ projectId, owner, how, members }: Props) {
  const [value, setValue] = useState(owner);
  const [note, setNote] = useState(HOW[how]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  // Follow the saved choice when the page refreshes.
  useEffect(() => setValue(owner), [owner]);
  return (
    <div className={`box logowner ${how === "guess" ? "warn" : ""}`}>
      <label>
        <b>Daily log by</b>
        <select
          value={value}
          disabled={pending || members.length < 2}
          onChange={(e) => {
            const next = e.target.value;
            const before = value;
            setValue(next);
            setError("");
            start(async () => {
              const r = await setDailyLogOwner(projectId, next);
              if (r.error) {
                setValue(before);
                setError(r.error);
              } else setNote("Saved. Only they get this job's daily log reminders.");
            });
          }}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className={error ? "err" : "fine"}>{error || note}</p>
    </div>
  );
}
