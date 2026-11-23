"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { docNumber, STATUS_LABEL, totals } from "@/lib/estimates";
import type { BudgetGroup, BudgetItem, DocRef } from "@/lib/budget";
import { KIND_UNIT, fmtQty, linkedQuantity } from "@/lib/takeoff";
import { addBudgetTemplate } from "@/app/(app)/office/actions";
import { CatalogPicker, LinkDialog, MoneyInput, grow, num, type CatGroup, type CatItem, type MeasureOpt, type Opt } from "../estimates/[eid]/EstimateEditor";

const PILL: Record<string, string> = { approved: "bc-done", pending: "warn" };
const cur = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (profit: number, price: number) => (price ? `${((profit / price) * 100).toFixed(2)}%` : "—");

// The job budget as a sheet: cost groups with their line items, starting
// empty. Add catalog items or catalog groups (a group like "New Build" brings
// all its sub-groups). Documents are made from it by ticking lines.
export default function BudgetEditor(props: {
  projectId: string; jobNumber: string | null;
  groups: BudgetGroup[]; items: BudgetItem[]; on: Record<string, DocRef[]>; unlinkedDocs: boolean;
  templates: { id: string; name: string }[];
  catalog: { groups: CatGroup[]; items: CatItem[] }; types: Opt[]; units: Opt[]; measures: MeasureOpt[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState(props.groups);
  const [items, setItems] = useState(props.items);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [wrap, setWrap] = useState(false);
  const [active, setActive] = useState<string | null>(props.groups.at(-1)?.id ?? null); // group new items go into
  const [picker, setPicker] = useState<"items" | "groups" | null>(null);
  const [menu, setMenu] = useState<"item" | "group" | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const unitName = (id: number | null) => props.units.find((u) => u.id === id)?.abbr ?? "";
  const measure = (id: string | null) => props.measures.find((m) => m.id === id) ?? null;
  const qty = (it: BudgetItem) => {
    const m = measure(it.measurement_id);
    return it.measurement_id && m ? linkedQuantity(m.value, Number(it.qty_factor), Number(it.waste_pct)) : Number(it.quantity) || 0;
  };
  const sumOf = (list: BudgetItem[]) => totals(list.map((i) => ({ q: qty(i), c: Number(i.unit_cost), p: Number(i.unit_price) })));
  const sum = sumOf(items);
  const signed = sumOf(items.filter((i) => props.on[i.id]?.some((d) => d.status === "approved")));

  async function save(table: string, id: string, patch: Record<string, unknown>) {
    setError("");
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) setError("Couldn't save that change. Try again.");
    else { setSaved("Saved"); setTimeout(() => setSaved(""), 1500); }
  }
  const patchItem = (id: string, patch: Partial<BudgetItem>, persist = true) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    if (persist) save("budget_items", id, patch);
  };
  const patchGroup = (id: string, patch: Partial<BudgetGroup>) => {
    setGroups((all) => all.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    save("budget_groups", id, patch);
  };
  async function addGroup(name = "New group", description = "") {
    const { data, error } = await supabase.from("budget_groups").insert({ project_id: props.projectId, name, description, position: groups.length }).select("id, name, description, position").single();
    if (error || !data) { setError("Couldn't add a group. Try again."); return null; }
    setGroups((g) => [...g, data as BudgetGroup]);
    setActive(data.id);
    return data.id as string;
  }
  async function addItems(list: (CatItem | null)[]) {
    let gid = active && groups.some((g) => g.id === active) ? active : null;
    if (!gid) {
      const cgName = list[0] ? props.catalog.groups.find((g) => g.id === list[0]!.cost_group_id)?.name : null;
      gid = await addGroup(cgName ?? "New group");
      if (!gid) return;
    }
    const base = items.filter((i) => i.group_id === gid).length;
    const rows = list.map((c, n) => ({
      project_id: props.projectId, group_id: gid, catalog_item_id: c?.id ?? null, name: c?.name ?? "New item", description: c?.description ?? "",
      cost_type_id: c?.cost_type_id ?? props.types[0]?.id ?? null, unit_id: c?.unit_id ?? props.units[0]?.id ?? null,
      quantity: c?.quantity ?? (c ? 0 : 1), unit_cost: c?.unit_cost ?? 0, unit_price: c?.unit_price ?? 0, position: base + n,
    }));
    const { data, error } = await supabase.from("budget_items").insert(rows).select("id, group_id, catalog_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position");
    if (error || !data) return setError("Couldn't add the item. Try again.");
    setItems((all) => [...all, ...(data as BudgetItem[])]);
    setClosed((c) => { const n = new Set(c); n.delete(gid!); return n; });
  }
  async function deleteItem(it: BudgetItem) {
    if (props.on[it.id]?.length && !confirm(`"${it.name}" is on a document. Remove it from the budget? Signed documents keep it.`)) return;
    setItems((all) => all.filter((i) => i.id !== it.id));
    const { error } = await supabase.from("budget_items").delete().eq("id", it.id);
    if (error) setError("Couldn't remove the item. Reload and try again.");
  }
  async function deleteGroup(g: BudgetGroup) {
    const n = items.filter((i) => i.group_id === g.id).length;
    if (n && !confirm(`Remove "${g.name}" and its ${n} items from the budget? Signed documents keep them.`)) return;
    setGroups((all) => all.filter((x) => x.id !== g.id));
    setItems((all) => all.filter((i) => i.group_id !== g.id));
    const { error } = await supabase.from("budget_groups").delete().eq("id", g.id);
    if (error) setError("Couldn't remove the group. Reload and try again.");
  }
  const addCatalogGroup = (id: string) =>
    start(async () => { const r = await addBudgetTemplate(props.projectId, id); if (r.error) setError(r.error); else location.reload(); });
  const toggle = (id: string) => setClosed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.id));

  return (
    <div className="page est">
      <div className="budget-bar">
        <p className="fine" style={{ margin: 0, flex: 1 }}>
          On signed documents: <b style={{ color: "var(--ink)" }}>{cur(signed.price)}</b> of {cur(sum.price)}
          <span aria-live="polite" style={{ marginLeft: 10 }}>{saved}</span>
        </p>
        {items.length > 0 && <Link className="btn" href={`/projects/${props.projectId}/estimates?new=1`}>+ New document from budget</Link>}
      </div>
      {error && <p className="err" role="alert">{error}</p>}

      <div className={`sheet-wrap ${wrap ? "wrap" : ""}`}>
        <table className="sheet">
          <thead>
            <tr>
              <th className="c-name">
                <span>Name</span>
                {groups.length > 0 && <button className="sheet-tool" onClick={() => setClosed(allClosed ? new Set() : new Set(groups.map((g) => g.id)))} title={allClosed ? "Expand all groups" : "Collapse all groups"}>{allClosed ? "⤢" : "⤡"}</button>}
              </th>
              <th className="c-desc"><span>Description</span><button className="sheet-tool" onClick={() => setWrap((w) => !w)} title={wrap ? "Show one line" : "Show full descriptions"}>{wrap ? "⤡" : "⤢"}</button></th>
              <th className="r">Quantity</th><th>Unit</th>
              <th className="r">Unit Cost</th><th className="r">Extended Cost</th>
              <th className="r">Unit Price</th><th className="r">Extended Price</th>
              <th className="r">Profit</th><th className="r">Margin</th>
              <th>Cost Type</th><th>On</th><th />
            </tr>
          </thead>
          <tbody>
            {!groups.length && (
              <tr><td colSpan={13} className="sheet-empty">The budget is empty. Add a cost group (a group like New Build brings all of its sub-groups) or catalog items below.</td></tr>
            )}
            {groups.map((g) => {
              const gItems = items.filter((i) => i.group_id === g.id).sort((a, b) => a.position - b.position);
              const gs = sumOf(gItems);
              const open = !closed.has(g.id);
              return [
                <tr key={g.id} className={`sheet-g ${active === g.id ? "active" : ""}`} onFocus={() => setActive(g.id)} onClick={() => setActive(g.id)}>
                  <td className="c-name">
                    <button className="sheet-chev" onClick={() => toggle(g.id)} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open}>{open ? "▾" : "▸"}</button>
                    <input className="sheet-in b" defaultValue={g.name} aria-label="Group name" onBlur={(e) => e.target.value !== g.name && patchGroup(g.id, { name: e.target.value })} />
                  </td>
                  <td className="c-desc"><textarea className="sheet-in" rows={1} ref={wrap ? grow : undefined} onInput={(e) => wrap && grow(e.currentTarget)} defaultValue={g.description} placeholder="Description the client reads" aria-label="Group description" onBlur={(e) => e.target.value !== g.description && patchGroup(g.id, { description: e.target.value })} /></td>
                  <td /><td /><td />
                  <td className="r">{cur(gs.cost)}</td>
                  <td />
                  <td className="r">{cur(gs.price)}</td>
                  <td className="r">{cur(gs.profit)}</td>
                  <td className="r">{pct(gs.profit, gs.price)}</td>
                  <td className="fine">{gItems.length} {gItems.length === 1 ? "item" : "items"}</td>
                  <td />
                  <td><button className="ei-x" onClick={() => deleteGroup(g)} aria-label={`Remove ${g.name}`}>×</button></td>
                </tr>,
                ...(open ? gItems : []).map((it) => {
                  const q = qty(it), m = measure(it.measurement_id);
                  const ec = q * Number(it.unit_cost), ep = q * Number(it.unit_price);
                  const docs = props.on[it.id] ?? [];
                  return (
                    <tr key={it.id} className="sheet-i" onFocus={() => setActive(g.id)}>
                      <td className="c-name"><textarea className="sheet-in" rows={1} ref={wrap ? grow : undefined} onInput={(e) => wrap && grow(e.currentTarget)} defaultValue={it.name} aria-label="Item name" onBlur={(e) => e.target.value !== it.name && patchItem(it.id, { name: e.target.value })} /></td>
                      <td className="c-desc"><textarea className="sheet-in" rows={1} ref={wrap ? grow : undefined} onInput={(e) => wrap && grow(e.currentTarget)} defaultValue={it.description} aria-label="Item description" onBlur={(e) => e.target.value !== it.description && patchItem(it.id, { description: e.target.value })} /></td>
                      <td className="r">
                        {it.measurement_id && m ? (
                          <button className="ei-qty linked" onClick={() => setLinking(it.id)} title={`From takeoff: ${m.name} ${m.value == null ? "(not scaled)" : fmtQty(m.value, KIND_UNIT[m.kind])}. Click to change.`}>{fmtQty(q)}</button>
                        ) : (
                          <span className="sheet-qty">
                            <button className="ei-take" onClick={() => setLinking(it.id)} title="Take the quantity from a plan takeoff" aria-label="Link to a takeoff">📐</button>
                            <input className="sheet-in r" defaultValue={it.quantity} inputMode="decimal" aria-label="Quantity" size={6}
                              onChange={(e) => patchItem(it.id, { quantity: num(e.target.value) }, false)}
                              onBlur={(e) => save("budget_items", it.id, { quantity: num(e.target.value) })} />
                          </span>
                        )}
                      </td>
                      <td>
                        <select className="sheet-in" value={it.unit_id ?? ""} aria-label="Unit" onChange={(e) => patchItem(it.id, { unit_id: Number(e.target.value) || null })}>
                          {props.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </td>
                      <td className="r"><MoneyInput value={it.unit_cost} label="Unit cost" locked={false} onChange={(v) => patchItem(it.id, { unit_cost: v }, false)} onCommit={(v) => save("budget_items", it.id, { unit_cost: v })} /></td>
                      <td className="r">{cur(ec)}</td>
                      <td className="r"><MoneyInput value={it.unit_price} label="Unit price" locked={false} onChange={(v) => patchItem(it.id, { unit_price: v }, false)} onCommit={(v) => save("budget_items", it.id, { unit_price: v })} /></td>
                      <td className="r">{cur(ep)}</td>
                      <td className="r">{cur(ep - ec)}</td>
                      <td className={`r ${ep && (ep - ec) / ep < 0.25 ? "margin-lo" : ""}`}>{pct(ep - ec, ep)}</td>
                      <td>
                        <select className="sheet-in" value={it.cost_type_id ?? ""} aria-label="Cost type" onChange={(e) => patchItem(it.id, { cost_type_id: Number(e.target.value) || null })}>
                          {props.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="sheet-on">
                          {docs.map((d) => (
                            <Link key={d.estimate_id} href={`/projects/${props.projectId}/estimates/${d.estimate_id}`} className={`pill ${PILL[d.status] ?? ""}`} title={`${d.name} · ${STATUS_LABEL[d.status]}`}>
                              {docNumber(props.jobNumber, d.seq)}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td><button className="ei-x" onClick={() => deleteItem(it)} aria-label={`Remove ${it.name}`}>×</button></td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <div className="sheet-add">
                  <div className="sheet-menu">
                    <button className="btn" onClick={() => setMenu(menu === "item" ? null : "item")} aria-expanded={menu === "item"}>+ Item</button>
                    {menu === "item" && (
                      <div className="sheet-pop" role="menu">
                        <button role="menuitem" onClick={() => { setMenu(null); setPicker("items"); }}>From the catalog</button>
                        <button role="menuitem" onClick={() => { setMenu(null); addItems([null]); }}>Blank item</button>
                        {active && <small>Goes into {groups.find((g) => g.id === active)?.name}. Click a group to change.</small>}
                      </div>
                    )}
                  </div>
                  <div className="sheet-menu">
                    <button className="btn" disabled={pending} onClick={() => setMenu(menu === "group" ? null : "group")} aria-expanded={menu === "group"}>{pending ? "Adding…" : "+ Group"}</button>
                    {menu === "group" && (
                      <div className="sheet-pop" role="menu">
                        <button role="menuitem" onClick={() => { setMenu(null); setPicker("groups"); }}>From the catalog</button>
                        <button role="menuitem" onClick={() => { setMenu(null); addGroup(); }}>Blank group</button>
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td colSpan={3} />
              <td className="r"><b>{cur(sum.cost)}</b></td>
              <td />
              <td className="r"><b>{cur(sum.price)}</b></td>
              <td className="r"><b>{cur(sum.profit)}</b></td>
              <td className={`r ${sum.price && sum.margin < 25 ? "margin-lo" : ""}`}><b>{pct(sum.profit, sum.price)}</b></td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="fine">Only the office sees the budget. Changing a line here also changes it on draft and pending documents; signed documents never change.</p>

      {picker && (
        <CatalogPicker
          mode={picker}
          catalog={props.catalog}
          unitAbbr={unitName}
          onClose={() => setPicker(null)}
          onPickItem={(c) => { addItems([c]); }}
          onPickGroup={(cg) => { setPicker(null); addCatalogGroup(cg.id); }}
        />
      )}
      {linking && (() => {
        const it = items.find((i) => i.id === linking)!;
        return (
          <LinkDialog
            item={it as never}
            unit={unitName(it.unit_id)}
            measures={props.measures}
            projectId={props.projectId}
            onClose={() => setLinking(null)}
            onSave={(mid, f, w) => {
              const mm = measure(mid);
              const q = mm ? linkedQuantity(mm.value, f, w) : qty(it);
              patchItem(it.id, { measurement_id: mid, qty_factor: f, waste_pct: w, quantity: Math.round(q * 100) / 100 });
              setLinking(null);
            }}
          />
        );
      })()}
    </div>
  );
}
