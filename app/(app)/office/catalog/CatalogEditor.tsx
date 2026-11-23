"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MoneyInput, grow, num } from "@/app/(app)/projects/[id]/(office)/estimates/[eid]/EstimateEditor";

export type Group = { id: string; parent_id: string | null; name: string; description: string; position: number };
export type Item = {
  id: string; cost_group_id: string | null; source_item_id: string | null; name: string; description: string;
  cost_type_id: number | null; unit_id: number | null; quantity: number | null; unit_cost: number | null; unit_price: number | null; position: number;
};
type Opt = { id: number; name: string; abbr?: string };

const cur = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (cost: number | null, price: number | null) => (price ? `${(((Number(price) - Number(cost ?? 0)) / Number(price)) * 100).toFixed(2)}%` : "—");
const ITEM_FIELDS = "id, cost_group_id, source_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, position";

// The catalog as a sheet, in two views: cost groups (nested, each with its
// items) and the item library (standalone priced items). Items are added to
// a group from the library, copying the library item's price, cost, unit,
// type and description. A group of groups (like New Build Out) is a template:
// adding it to a budget brings every group inside it.
export default function CatalogEditor(props: { groups: Group[]; items: Item[]; types: Opt[]; units: Opt[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<"groups" | "library">("groups");
  const [groups, setGroups] = useState(props.groups);
  const [items, setItems] = useState(props.items);
  const [closed, setClosed] = useState<Set<string>>(() => new Set(props.groups.filter((g) => g.parent_id).map((g) => g.id)));
  const [wrap, setWrap] = useState(false);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<string | null>(null); // group id getting library items
  const [moving, setMoving] = useState<Item | null>(null); // library item being added to a group
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const needle = q.trim().toLowerCase();
  const library = items.filter((i) => !i.cost_group_id);
  const kids = (id: string | null) => groups.filter((g) => (id ? g.parent_id === id : !g.parent_id || !groups.some((p) => p.id === g.parent_id))).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const itemsIn = (gid: string) => items.filter((i) => i.cost_group_id === gid).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const hits = (i: Item) => !needle || `${i.name} ${i.description}`.toLowerCase().includes(needle);
  const groupHits = (g: Group): boolean => !needle || g.name.toLowerCase().includes(needle) || itemsIn(g.id).some(hits) || kids(g.id).some(groupHits);
  const deepCount = (g: Group): number => itemsIn(g.id).length + kids(g.id).reduce((s, k) => s + deepCount(k), 0);
  const deepSum = (g: Group): { cost: number; price: number } => {
    const own = itemsIn(g.id).reduce((s, i) => ({ cost: s.cost + Number(i.quantity ?? 1) * Number(i.unit_cost ?? 0), price: s.price + Number(i.quantity ?? 1) * Number(i.unit_price ?? 0) }), { cost: 0, price: 0 });
    return kids(g.id).reduce((s, k) => { const d = deepSum(k); return { cost: s.cost + d.cost, price: s.price + d.price }; }, own);
  };

  async function save(table: string, id: string, patch: Record<string, unknown>) {
    setError("");
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) setError("Couldn't save that change. Try again.");
    else { setSaved("Saved"); setTimeout(() => setSaved(""), 1500); }
  }
  const patchItem = (id: string, patch: Partial<Item>, persist = true) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    if (persist) save("cost_items", id, patch);
  };
  const patchGroup = (id: string, patch: Partial<Group>) => {
    setGroups((all) => all.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    save("cost_groups", id, patch);
  };
  async function addGroup(parent: string | null) {
    const { data, error } = await supabase.from("cost_groups").insert({ name: "New group", parent_id: parent, position: kids(parent).length }).select("id, parent_id, name, description, position").single();
    if (error || !data) return setError("Couldn't add the group. Try again.");
    setGroups((g) => [...g, data as Group]);
    if (parent) setClosed((c) => { const n = new Set(c); n.delete(parent); return n; });
  }
  async function addItems(gid: string | null, from: (Item | null)[]) {
    const base = gid ? itemsIn(gid).length : library.length;
    const rows = from.map((s, n) => ({
      cost_group_id: gid, source_item_id: s?.id ?? null, name: s?.name ?? "New item", description: s?.description ?? "",
      cost_type_id: s?.cost_type_id ?? props.types[0]?.id ?? null, unit_id: s?.unit_id ?? props.units[0]?.id ?? null,
      quantity: s?.quantity ?? null, unit_cost: s?.unit_cost ?? null, unit_price: s?.unit_price ?? null, position: base + n,
    }));
    const { data, error } = await supabase.from("cost_items").insert(rows).select(ITEM_FIELDS);
    if (error || !data) return setError("Couldn't add the item. Try again.");
    setItems((all) => [...all, ...(data as Item[])]);
    if (gid) setClosed((c) => { const n = new Set(c); n.delete(gid); return n; });
  }
  async function removeItem(it: Item) {
    if (!it.cost_group_id && !confirm(`Remove "${it.name}" from the library? Groups that use it keep their copy.`)) return;
    setItems((all) => all.filter((i) => i.id !== it.id));
    await save("cost_items", it.id, { archived: true });
  }
  async function removeGroup(g: Group) {
    const n = deepCount(g);
    if (!confirm(`Remove "${g.name}"${n ? ` and its ${n} items` : ""} from the catalog? Budgets already made from it don't change.`)) return;
    const ids: string[] = [];
    const walk = (x: Group) => { ids.push(x.id); kids(x.id).forEach(walk); };
    walk(g);
    setGroups((all) => all.filter((x) => !ids.includes(x.id)));
    setItems((all) => all.filter((i) => !i.cost_group_id || !ids.includes(i.cost_group_id)));
    const { error } = await supabase.from("cost_groups").update({ archived: true }).in("id", ids);
    if (!error) await supabase.from("cost_items").update({ archived: true }).in("cost_group_id", ids);
    if (error) setError("Couldn't remove the group. Reload and try again.");
  }
  const toggle = (id: string) => setClosed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const srcName = (id: string | null) => (id ? items.find((i) => i.id === id)?.name : undefined);

  const itemRow = (it: Item, depth: number) => {
    const qn = Number(it.quantity ?? 1);
    const from = srcName(it.source_item_id);
    return (
      <tr key={it.id} className="sheet-i">
        <td className="c-name" style={{ paddingLeft: 26 + depth * 18 }}>
          <textarea className="sheet-in" rows={1} ref={wrap ? grow : undefined} onInput={(e) => wrap && grow(e.currentTarget)} defaultValue={it.name} aria-label="Item name" onBlur={(e) => e.target.value.trim() && e.target.value !== it.name && patchItem(it.id, { name: e.target.value.trim() })} />
          {from && from !== it.name && <small className="cat-from" title="Copied from this library item">from {from}</small>}
        </td>
        <td className="c-desc"><textarea className="sheet-in" rows={1} ref={wrap ? grow : undefined} onInput={(e) => wrap && grow(e.currentTarget)} defaultValue={it.description} aria-label="Item description" onBlur={(e) => e.target.value !== it.description && patchItem(it.id, { description: e.target.value })} /></td>
        <td className="r"><input className="sheet-in r" defaultValue={it.quantity ?? ""} placeholder="1" inputMode="decimal" size={6} aria-label="Default quantity" onBlur={(e) => patchItem(it.id, { quantity: e.target.value.trim() ? num(e.target.value) : null })} /></td>
        <td>
          <select className="sheet-in" value={it.unit_id ?? ""} aria-label="Unit" onChange={(e) => patchItem(it.id, { unit_id: Number(e.target.value) || null })}>
            {props.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </td>
        <td className="r"><MoneyInput value={it.unit_cost ?? 0} label="Unit cost" locked={false} onChange={() => {}} onCommit={(v) => patchItem(it.id, { unit_cost: v })} /></td>
        <td className="r">{cur(qn * Number(it.unit_cost ?? 0))}</td>
        <td className="r"><MoneyInput value={it.unit_price ?? 0} label="Unit price" locked={false} onChange={() => {}} onCommit={(v) => patchItem(it.id, { unit_price: v })} /></td>
        <td className="r">{cur(qn * Number(it.unit_price ?? 0))}</td>
        <td className={`r ${it.unit_price && (Number(it.unit_price) - Number(it.unit_cost ?? 0)) / Number(it.unit_price) < 0.25 ? "margin-lo" : ""}`}>{pct(it.unit_cost, it.unit_price)}</td>
        <td>
          <select className="sheet-in" value={it.cost_type_id ?? ""} aria-label="Cost type" onChange={(e) => patchItem(it.id, { cost_type_id: Number(e.target.value) || null })}>
            {props.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </td>
        <td className="sheet-acts">
          {!it.cost_group_id && <button className="textbtn" onClick={() => setMoving(it)}>Add to group</button>}
          <button className="ei-x" onClick={() => removeItem(it)} aria-label={`Remove ${it.name}`}>×</button>
        </td>
      </tr>
    );
  };

  const groupRows = (g: Group, depth: number): React.ReactNode[] => {
    if (!groupHits(g)) return [];
    const open = needle ? true : !closed.has(g.id);
    const s = deepSum(g);
    const sub = kids(g.id);
    return [
      <tr key={g.id} className={`sheet-g ${depth ? "sub" : ""}`}>
        <td className="c-name" style={{ paddingLeft: 8 + depth * 18 }}>
          <span className="sheet-gname">
            <button className="sheet-chev" onClick={() => toggle(g.id)} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open}>{open ? "▾" : "▸"}</button>
            <input className="sheet-in b" defaultValue={g.name} aria-label="Group name" onBlur={(e) => e.target.value.trim() && e.target.value !== g.name && patchGroup(g.id, { name: e.target.value.trim() })} />
          </span>
        </td>
        <td className="c-desc"><textarea className="sheet-in" rows={1} ref={wrap ? grow : undefined} onInput={(e) => wrap && grow(e.currentTarget)} defaultValue={g.description} placeholder="Description clients read" aria-label="Group description" onBlur={(e) => e.target.value !== g.description && patchGroup(g.id, { description: e.target.value })} /></td>
        <td colSpan={3} className="fine">{sub.length ? `${sub.length} ${sub.length === 1 ? "group" : "groups"} · ` : ""}{deepCount(g)} items</td>
        <td className="r">{cur(s.cost)}</td>
        <td />
        <td className="r">{cur(s.price)}</td>
        <td className="r">{pct(s.cost, s.price)}</td>
        <td />
        <td className="sheet-acts">
          <button className="textbtn" onClick={() => setPicking(g.id)}>+ Items</button>
          <button className="textbtn" onClick={() => addGroup(g.id)}>+ Group</button>
          <button className="ei-x" onClick={() => removeGroup(g)} aria-label={`Remove ${g.name}`}>×</button>
        </td>
      </tr>,
      ...(open ? [...sub.flatMap((k) => groupRows(k, depth + 1)), ...itemsIn(g.id).filter(hits).map((it) => itemRow(it, depth))] : []),
    ];
  };

  const head = (
    <thead>
      <tr>
        <th className="c-name">Name</th>
        <th className="c-desc"><span>Description</span><button className="sheet-tool" onClick={() => setWrap((w) => !w)} title={wrap ? "Show one line" : "Show full descriptions"}>{wrap ? "⤡" : "⤢"}</button></th>
        <th className="r">Quantity</th><th>Unit</th>
        <th className="r">Unit Cost</th><th className="r">Extended Cost</th>
        <th className="r">Unit Price</th><th className="r">Extended Price</th>
        <th className="r">Margin</th><th>Cost Type</th><th />
      </tr>
    </thead>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="otools">
        <div className="chips" role="tablist" aria-label="View">
          <button className="chip" role="tab" aria-pressed={view === "groups"} onClick={() => setView("groups")}>Cost groups · {groups.length}</button>
          <button className="chip" role="tab" aria-pressed={view === "library"} onClick={() => setView("library")}>Items · {library.length}</button>
        </div>
        <input className="osearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog" />
        <span className="fine" aria-live="polite">{saved}</span>
        <span style={{ flex: 1 }} />
        {view === "groups" ? <button className="btn" onClick={() => addGroup(null)}>+ New cost group</button> : <button className="btn" onClick={() => addItems(null, [null])}>+ New item</button>}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <p className="fine" style={{ margin: 0 }}>
        {view === "groups"
          ? "A group of groups (like New Build Out) is a template: adding it to a budget brings every group inside it. Use + Items to add items from your library; each copies the item's price, cost, unit and description, and you can change the copy."
          : "Your library: every standalone item with its price. Add items to cost groups from here or from a group's + Items."}
      </p>
      <div className={`sheet-wrap ${wrap ? "wrap" : ""}`}>
        <table className="sheet">
          {head}
          <tbody>
            {view === "groups"
              ? kids(null).flatMap((g) => groupRows(g, 0))
              : library.filter(hits).sort((a, b) => a.name.localeCompare(b.name)).map((it) => itemRow(it, -1))}
            {view === "groups" && !groups.length && <tr><td colSpan={11} className="sheet-empty">No cost groups yet. Add one, or import your catalog from JobTread.</td></tr>}
          </tbody>
        </table>
      </div>

      {picking && (
        <LibraryPicker
          title={`Add items to ${groups.find((g) => g.id === picking)?.name}`}
          library={library}
          units={props.units}
          onClose={() => setPicking(null)}
          onAdd={(list) => { addItems(picking, list); setPicking(null); }}
          onBlank={() => { addItems(picking, [null]); setPicking(null); }}
        />
      )}
      {moving && (
        <GroupPicker
          item={moving}
          groups={groups}
          onClose={() => setMoving(null)}
          onPick={(gid) => { addItems(gid, [moving]); setMoving(null); setSaved(`Added to ${groups.find((g) => g.id === gid)?.name}`); }}
        />
      )}
    </div>
  );
}

// Tick library items to copy into a group.
function LibraryPicker({ title, library, units, onClose, onAdd, onBlank }: { title: string; library: Item[]; units: Opt[]; onClose: () => void; onAdd: (list: Item[]) => void; onBlank: () => void }) {
  const [q, setQ] = useState("");
  const [on, setOn] = useState<Set<string>>(new Set());
  const needle = q.trim().toLowerCase();
  const list = library.filter((i) => !needle || `${i.name} ${i.description}`.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
  const unit = (id: number | null) => units.find((u) => u.id === id)?.abbr ?? "";
  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: "min(640px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div className="sec-h"><h2>{title}</h2><button className="textbtn" onClick={onClose}>Cancel</button></div>
        <input className="osearch" style={{ width: "100%" }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your items" aria-label="Search your items" />
        <div className="pick" style={{ maxHeight: "none", flex: 1 }}>
          {list.map((i) => (
            <label key={i.id} className="pick-i" style={{ paddingLeft: 10 }}>
              <input type="checkbox" checked={on.has(i.id)} onChange={(e) => setOn((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
              <span>{i.name}{i.description && <small>{i.description}</small>}</span>
              <span className="r">{cur(Number(i.unit_price ?? 0))}{unit(i.unit_id) && unit(i.unit_id) !== "LS" ? ` / ${unit(i.unit_id)}` : ""}</span>
            </label>
          ))}
          {!list.length && <p className="fine" style={{ padding: 10 }}>No items match.</p>}
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={onBlank}>Blank item instead</button>
          <button className="btn" disabled={!on.size} onClick={() => onAdd(library.filter((i) => on.has(i.id)))}>Add {on.size || ""} {on.size === 1 ? "item" : "items"}</button>
        </div>
      </div>
    </div>
  );
}

function GroupPicker({ item, groups, onClose, onPick }: { item: Item; groups: Group[]; onClose: () => void; onPick: (gid: string) => void }) {
  const [gid, setGid] = useState("");
  const label = (g: Group): string => { const p = groups.find((x) => x.id === g.parent_id); return p ? `${label(p)} › ${g.name}` : g.name; };
  const opts = groups.map((g) => ({ id: g.id, name: label(g) })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add to a cost group">
        <h2>Add to a cost group</h2>
        <p className="fine">{item.name} is copied into the group with its price, cost, unit and description. It stays in your library too.</p>
        <label className="field">Cost group<select value={gid} onChange={(e) => setGid(e.target.value)} autoFocus><option value="">Choose a group…</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <div className="actions"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!gid} onClick={() => onPick(gid)}>Add</button></div>
      </div>
    </div>
  );
}
