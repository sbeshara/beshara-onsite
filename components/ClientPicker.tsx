"use client";

// Who on the client side is in a chat: everyone on the project (including
// clients added later), or only the ones ticked.
export type ClientChoice = { everyone: boolean; ids: string[] };

export default function ClientPicker({ clients, value, onChange }: { clients: { id: string; name: string }[]; value: ClientChoice; onChange: (v: ClientChoice) => void }) {
  if (!clients.length) return <p className="sub" style={{ margin: 0 }}>No clients are on this project yet. Anyone added later will see this chat.</p>;
  return (
    <fieldset className="cpick">
      <legend>Which clients are in this chat?</legend>
      <label className="cpick-opt">
        <input type="radio" name="cpick" checked={value.everyone} onChange={() => onChange({ everyone: true, ids: value.ids })} />
        <span><b>Every client on this project</b><small>Including clients added later.</small></span>
      </label>
      <label className="cpick-opt">
        <input type="radio" name="cpick" checked={!value.everyone} onChange={() => onChange({ everyone: false, ids: value.ids })} />
        <span><b>Only the clients I pick</b><small>The others won&apos;t see this chat, its files or its notifications.</small></span>
      </label>
      {!value.everyone && (
        <div className="cpick-list">
          {clients.map((c) => (
            <label key={c.id} className={value.ids.includes(c.id) ? "on" : ""}>
              <input
                type="checkbox"
                checked={value.ids.includes(c.id)}
                onChange={(e) => onChange({ everyone: false, ids: e.target.checked ? [...value.ids, c.id] : value.ids.filter((x) => x !== c.id) })}
              />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
