"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { archiveGroup, archiveItem, saveGroup, saveItem, type Result } from "../actions";
import { marginPct, usd } from "@/lib/office";

export type Group = { id: string; parent_id: string | null; name: string; description: string; position: number };
export type Item = { id: string; cost_group_id: string | null; name: string; description: string; cost_type_id: number | null; unit_id: number | null; unit_cost: number | null; unit_price: number | null };
type Opt = { id: number; name: string; abbr?: string };

function ItemForm({ item, groupId, groups, types, units, onDone }: { item?: Item; groupId: string | null; groups: Group[]; types: Opt[]; units: Opt[]; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result, FormData>(async (p, f) => {
    const r = await saveItem(p, f);
    if (r.ok) onDone();
    return r;
  }, {});
  return (
    <form className="iform" action={action}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="row">
        <label>Item<input name="name" required defaultValue={item?.name} autoFocus /></label>
        <label>Cost type<select name="cost_type_id" defaultValue={item?.cost_type_id ?? types[0]?.id}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Unit<select name="unit_id" defaultValue={item?.unit_id ?? units[0]?.id}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label>Unit cost<input name="unit_cost" inputMode="decimal" defaultValue={item?.unit_cost ?? ""} /></label>
        <label>Unit price<input name="unit_price" inputMode="decimal" defaultValue={item?.unit_price ?? ""} /></label>
      </div>
      <div className="row2">
        <label>Description clients can see<input name="description" defaultValue={item?.description} placeholder="Optional" /></label>
        <label>Cost group<select name="cost_group_id" defaultValue={item?.cost_group_id ?? groupId ?? ""}><option value="">No group</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : item ? "Save item" : "Add item"}</button>
        <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function GroupForm({ group, parents, onDone }: { group?: Group; parents: Group[]; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result, FormData>(async (p, f) => {
    const r = await saveGroup(p, f);
    if (r.ok) onDone();
    return r;
  }, {});
  return (
    <form className="iform" action={action}>
      {group && <input type="hidden" name="id" value={group.id} />}
      <div className="row2">
        <label>Cost group<input name="name" required defaultValue={group?.name} autoFocus /></label>
        <label>Inside<select name="parent_id" defaultValue={group?.parent_id ?? ""}><option value="">Top level</option>{parents.filter((p) => p.id !== group?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label>Description clients read on proposals<textarea name="description" rows={4} defaultValue={group?.description} /></label>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : group ? "Save group" : "Add group"}</button>
        <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function CatalogEditor({ groups, items, types, units }: { groups: Group[]; items: Item[]; types: Opt[]; units: Opt[] }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // "item:<id>", "group:<id>", "new-item:<groupId>", "new-group"
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const typeName = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t.name])), [types]);
  const unitAbbr = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.abbr ?? u.name])), [units]);
  const needle = q.trim().toLowerCase();
  const matches = (i: Item) => !needle || `${i.name} ${i.description}`.toLowerCase().includes(needle);
  const top = groups.filter((g) => !g.parent_id || !groups.some((p) => p.id === g.parent_id));
  const children = (id: string) => groups.filter((g) => g.parent_id === id);
  const itemsIn = (id: string | null) => items.filter((i) => i.cost_group_id === id && matches(i));
  const count = (g: Group): number => itemsIn(g.id).length + children(g.id).reduce((s, c) => s + count(c), 0);
  const done = () => setEditing(null);

  const itemTable = (list: Item[], groupId: string | null) => (
    <>
      {list.length > 0 && (
        <div className="otable-wrap">
          <table className="otable">
            <thead><tr><th>Item</th><th>Type</th><th>Unit</th><th className="r">Unit cost</th><th className="r">Unit price</th><th className="r">Margin</th><th /></tr></thead>
            <tbody>
              {list.map((i) =>
                editing === `item:${i.id}` ? (
                  <tr key={i.id}><td colSpan={7} style={{ padding: 0 }}><ItemForm item={i} groupId={groupId} groups={groups} types={types} units={units} onDone={done} /></td></tr>
                ) : (
                  <tr key={i.id}>
                    <td><b>{i.name}</b>{i.description && <small>{i.description}</small>}</td>
                    <td><span className="ctype">{i.cost_type_id ? typeName[i.cost_type_id] : ""}</span></td>
                    <td>{i.unit_id ? unitAbbr[i.unit_id] : ""}</td>
                    <td className="r">{usd(i.unit_cost, true)}</td>
                    <td className="r">{usd(i.unit_price, true)}</td>
                    {(() => {
                      const m = marginPct(i.unit_cost, i.unit_price);
                      return <td className={`r ${m != null && m < 25 ? "margin-lo" : ""}`}>{m == null ? "" : `${m.toFixed(1)}%`}</td>;
                    })()}
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      <button className="textbtn" onClick={() => setEditing(`item:${i.id}`)}>Edit</button>{" · "}
                      <button className="textbtn" disabled={pending} onClick={() => start(async () => setMsg(await archiveItem(i.id)))}>Remove</button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing === `new-item:${groupId ?? "none"}` ? (
        <ItemForm groupId={groupId} groups={groups} types={types} units={units} onDone={done} />
      ) : (
        <div style={{ padding: "8px 12px" }}><button className="textbtn" onClick={() => setEditing(`new-item:${groupId ?? "none"}`)}>+ Add item</button></div>
      )}
    </>
  );

  const groupBlock = (g: Group, depth = 0): React.ReactNode => {
    const n = count(g);
    if (needle && !n && !g.name.toLowerCase().includes(needle)) return null;
    return (
      <details key={g.id} className="cgroup" open={needle ? true : undefined} style={depth ? { margin: "8px 12px" } : undefined}>
        <summary>
          <h3>{g.name}</h3>
          <span className="fine">{n} {n === 1 ? "item" : "items"}{children(g.id).length ? ` · ${children(g.id).length} groups` : ""}</span>
        </summary>
        {editing === `group:${g.id}` ? (
          <GroupForm group={g} parents={groups} onDone={done} />
        ) : (
          <div className="cdesc">
            {g.description || <span>No client description yet.</span>}
            <div style={{ marginTop: 6 }}>
              <button className="textbtn" onClick={() => setEditing(`group:${g.id}`)}>Edit group</button>{" · "}
              <button className="textbtn" disabled={pending} onClick={() => start(async () => setMsg(await archiveGroup(g.id)))}>Remove group</button>
            </div>
          </div>
        )}
        {children(g.id).map((c) => groupBlock(c, depth + 1))}
        {itemTable(itemsIn(g.id), g.id)}
      </details>
    );
  };

  const loose = itemsIn(null);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="otools">
        <input className="osearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${items.length} items`} aria-label="Search the catalog" />
        <button className="btn ghost" onClick={() => setEditing("new-group")}>+ New cost group</button>
      </div>
      {msg.error && <p className="err" role="alert">{msg.error}</p>}
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}
      {editing === "new-group" && <div className="cgroup"><GroupForm parents={groups} onDone={done} /></div>}
      {top.map((g) => groupBlock(g))}
      <details className="cgroup" open={loose.length > 0 && !top.length}>
        <summary><h3>Items without a group</h3><span className="fine">{loose.length} items</span></summary>
        {itemTable(loose, null)}
      </details>
      {!groups.length && !items.length && <p className="empty">The catalog is empty. Import it from JobTread, or add a cost group to start.</p>}
    </div>
  );
}
