"use client";

// "View As": for the Principal Contractor and Admins, in the top bar. Pick a
// team member to see OnSite and HQ the way they do (read-only); pick
// "Myself" to go back.
type Person = { id: string; name: string; role: string };

export default function ViewAsPicker({ people, current, site, back }: { people: Person[]; current: string | null; site: string; back?: "hq" }) {
  const groups = [...new Set(people.map((p) => p.role))];
  return (
    <label className="viewas">
      <span>View As</span>
      <select
        aria-label="View As"
        value={current ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          const to = back ? `&to=${back}` : "";
          location.href = id ? `${site}/view-as?user=${id}${to}` : `${site}/view-as/exit${back ? `?to=${back}` : ""}`;
        }}
      >
        <option value="">Myself</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {people.filter((p) => p.role === g).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
