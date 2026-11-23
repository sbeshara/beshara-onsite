"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { docNumber, STATUS_LABEL, totals } from "@/lib/estimates";
import type { BudgetGroup, BudgetItem, DocRef } from "@/lib/budget";
import { usd } from "@/lib/office";
import { KIND_UNIT, fmtQty, linkedQuantity } from "@/lib/takeoff";
import { addBudgetTemplate, buildBudgetFromDocuments } from "@/app/(app)/office/actions";
import { CatalogPicker, LinkDialog, MoneyInput, grow, num, type CatGroup, type CatItem, type MeasureOpt, type Opt } from "../estimates/[eid]/EstimateEditor";

const PILL: Record<string, string> = { approved: "bc-done", pending: "warn" };

// The job budget: every cost group and item, itemized, for the office only.
// Documents are made from it by ticking lines; this shows which document
// each line is on.
export default function BudgetEditor(props: {
  projectId: string; jobNumber: string | null;
  groups: BudgetGroup[]; items: BudgetItem[]; on: Record<string, DocRef[]>; unlinkedDocs: boolean;
  templates: { id: string; name: string }[];
  catalog: { groups: CatGroup[]; items: CatItem[] }; types: Opt[]; units: Opt[]; measures: MeasureOpt[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState(props.groups);
  const [items, setItems] = useState(props.items);
  const [picker, setPicker] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const unitAbbr = (id: number | null) => props.units.find((u) => u.id === id)?.abbr ?? "";
  const measure = (id: string | null) => props.measures.find((m) => m.id === id) ?? null;
  const qty = (it: BudgetItem) => {
    const m = measure(it.measurement_id);
    return it.measurement_id && m ? linkedQuantity(m.value, Number(it.qty_factor), Number(it.waste_pct)) : Number(it.quantity) || 0;
  };
  const sumOf = (list: BudgetItem[]) => totals(list.map((i) => ({ q: qty(i), c: Number(i.unit_cost), p: Number(i.unit_price) })));
  const sum = sumOf(items);
  const signedLines = items.filter((i) => props.on[i.id]?.some((d) => d.status === "approved"));
  const loose = items.filter((i) => !props.on[i.id]?.some((d) => d.status !== "denied"));

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
  async function addGroup(name = "New group", description = "") {
    const { data, error } = await supabase.from("budget_groups").insert({ project_id: props.projectId, name, description, position: groups.length }).select("id, name, description, position").single();
    if (error || !data) { setError("Couldn't add a group. Try again."); return null; }
    setGroups((g) => [...g, data as BudgetGroup]);
    return data.id as string;
  }
  async function addItems(groupId: string, list: (CatItem | null)[]) {
    const base = items.filter((i) => i.group_id === groupId).length;
    const rows = list.map((c, n) => ({
      project_id: props.projectId, group_id: groupId, catalog_item_id: c?.id ?? null, name: c?.name ?? "New item", description: c?.description ?? "",
      cost_type_id: c?.cost_type_id ?? props.types[0]?.id ?? null, unit_id: c?.unit_id ?? props.units[0]?.id ?? null,
      quantity: c?.quantity ?? (c ? 0 : 1), unit_cost: c?.unit_cost ?? 0, unit_price: c?.unit_price ?? 0, position: base + n,
    }));
    const { data, error } = await supabase.from("budget_items").insert(rows).select("id, group_id, catalog_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position");
    if (error || !data) return setError("Couldn't add the item. Try again.");
    setItems((all) => [...all, ...(data as BudgetItem[])]);
  }
  async function deleteItem(it: BudgetItem) {
    if (props.on[it.id]?.length && !confirm(`"${it.name}" is on ${props.on[it.id].length === 1 ? "a document" : "documents"}. Remove it from the budget? Signed documents keep it; drafts keep their copy but it stops syncing.`)) return;
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
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => { const r = await fn(); if (r.error) setError(r.error); else { setNote(r.ok ?? ""); location.reload(); } });

  return (
    <div className="page est">
      <div className="budget-bar">
        <div className="budget-sum">
          <div><span>Cost</span><b>{usd(sum.cost)}</b></div>
          <div><span>Price</span><b>{usd(sum.price)}</b></div>
          <div><span>Profit</span><b>{usd(sum.profit)}</b></div>
          <div><span>Margin</span><b className={sum.price && sum.margin < 25 ? "margin-lo" : ""}>{sum.price ? `${sum.margin.toFixed(1)}%` : "—"}</b></div>
          <div><span>On signed documents</span><b>{usd(sumOf(signedLines).price)}</b></div>
          <div><span>Not on a document</span><b>{loose.length} {loose.length === 1 ? "line" : "lines"}</b></div>
        </div>
        <span className="fine" aria-live="polite">{saved}</span>
        <Link className="btn" href={`/projects/${props.projectId}/estimates?new=1`}>+ New document from budget</Link>
      </div>
      {note && <p className="ok" role="status">{note}</p>}
      {error && <p className="err" role="alert">{error}</p>}

      {!groups.length && (
        <section className="ocard">
          <h2>Start the budget</h2>
          <p className="fine">Everything for this job goes here, itemized for you. Documents are made by ticking what to include.</p>
          <div className="actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            {props.unlinkedDocs && <button className="btn" disabled={pending} onClick={() => run(() => buildBudgetFromDocuments(props.projectId))}>{pending ? "Building…" : "Build it from this job's documents"}</button>}
            <button className="btn ghost" onClick={() => addGroup()}>+ Empty group</button>
          </div>
        </section>
      )}

      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        {groups.map((g) => {
          const gItems = items.filter((i) => i.group_id === g.id).sort((a, b) => a.position - b.position);
          const gs = sumOf(gItems);
          return (
            <section key={g.id} className="est-group">
              <div className="est-gh">
                <input defaultValue={g.name} aria-label="Group name" onBlur={(e) => e.target.value !== g.name && (setGroups((all) => all.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x))), save("budget_groups", g.id, { name: e.target.value }))} />
                <span className="fine">{usd(gs.cost)} cost · {gs.price ? `${gs.margin.toFixed(1)}%` : "—"}</span>
                <b className="num">{usd(gs.price)}</b>
              </div>
              <label className="est-desc">
                <span>Description the client reads</span>
                <textarea ref={grow} onInput={(e) => grow(e.currentTarget)} defaultValue={g.description} rows={1} onBlur={(e) => e.target.value !== g.description && save("budget_groups", g.id, { description: e.target.value })} />
              </label>
              <div className="otable-wrap">
                <table className="otable est-items">
                  <thead><tr><th>Item</th><th>Type</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit cost</th><th className="r">Unit price</th><th className="r">Total</th><th className="r">Margin</th><th>On</th><th /></tr></thead>
                  <tbody>
                    {gItems.map((it) => {
                      const q = qty(it), m = measure(it.measurement_id);
                      const margin = Number(it.unit_price) ? ((Number(it.unit_price) - Number(it.unit_cost)) / Number(it.unit_price)) * 100 : 0;
                      const docs = props.on[it.id] ?? [];
                      return (
                        <tr key={it.id}>
                          <td>
                            <textarea className="ei-name" ref={grow} onInput={(e) => grow(e.currentTarget)} rows={1} defaultValue={it.name} aria-label="Item name" onBlur={(e) => e.target.value !== it.name && patchItem(it.id, { name: e.target.value })} />
                            <textarea className="ei-desc" ref={grow} onInput={(e) => grow(e.currentTarget)} rows={1} defaultValue={it.description} placeholder="Description (optional)" aria-label="Item description" onBlur={(e) => e.target.value !== it.description && patchItem(it.id, { description: e.target.value })} />
                            {it.measurement_id && <small className="ei-link">{m ? `📐 ${m.name} ${m.value == null ? "(sheet not scaled)" : fmtQty(m.value, KIND_UNIT[m.kind])} × ${it.qty_factor}${Number(it.waste_pct) ? ` + ${it.waste_pct}% waste` : ""}` : "📐 Takeoff was deleted; using the last quantity"}</small>}
                          </td>
                          <td>
                            <select className="ei-unit ei-type" value={it.cost_type_id ?? ""} aria-label="Type" onChange={(e) => patchItem(it.id, { cost_type_id: Number(e.target.value) || null })}>
                              {props.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </td>
                          <td className="r">
                            {it.measurement_id && m ? (
                              <button className="ei-qty linked" onClick={() => setLinking(it.id)} title="From takeoff. Click to change.">{fmtQty(q)}</button>
                            ) : (
                              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                <input className="ei-num" defaultValue={it.quantity} inputMode="decimal" aria-label="Quantity"
                                  onChange={(e) => patchItem(it.id, { quantity: num(e.target.value) }, false)}
                                  onBlur={(e) => save("budget_items", it.id, { quantity: num(e.target.value) })} />
                                <button className="ei-take" onClick={() => setLinking(it.id)} title="Take the quantity from a plan takeoff" aria-label="Link to a takeoff">📐</button>
                              </span>
                            )}
                          </td>
                          <td>
                            <select className="ei-unit" value={it.unit_id ?? ""} aria-label="Unit" onChange={(e) => patchItem(it.id, { unit_id: Number(e.target.value) || null })}>
                              {props.units.map((u) => <option key={u.id} value={u.id}>{u.abbr}</option>)}
                            </select>
                          </td>
                          <td className="r"><MoneyInput value={it.unit_cost} label="Unit cost" locked={false} onChange={(v) => patchItem(it.id, { unit_cost: v }, false)} onCommit={(v) => save("budget_items", it.id, { unit_cost: v })} /></td>
                          <td className="r"><MoneyInput value={it.unit_price} label="Unit price" locked={false} onChange={(v) => patchItem(it.id, { unit_price: v }, false)} onCommit={(v) => save("budget_items", it.id, { unit_price: v })} /></td>
                          <td className="r"><b>{usd(q * Number(it.unit_price))}</b></td>
                          <td className={`r ${Number(it.unit_price) && margin < 25 ? "margin-lo" : ""}`}>{Number(it.unit_price) ? `${margin.toFixed(1)}%` : ""}</td>
                          <td className="bud-on"><div>
                            {docs.length ? docs.map((d) => (
                              <Link key={d.estimate_id} href={`/projects/${props.projectId}/estimates/${d.estimate_id}`} className={`pill ${PILL[d.status] ?? ""}`} title={`${d.name} · ${STATUS_LABEL[d.status]}`}>
                                {d.kind === "Change Order" ? "CO" : d.kind === "Additional Scope" ? "AS" : "P"} {docNumber(props.jobNumber, d.seq)}
                              </Link>
                            )) : <small className="fine">—</small>}
                          </div></td>
                          <td><button className="ei-x" onClick={() => deleteItem(it)} aria-label={`Remove ${it.name}`}>×</button></td>
                        </tr>
                      );
                    })}
                    {!gItems.length && <tr><td colSpan={10} className="fine">No items yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="est-gf">
                <button className="linkbtn" onClick={() => setPicker(g.id)}>+ Add from catalog</button>
                <button className="textbtn" onClick={() => addItems(g.id, [null])}>+ Custom item</button>
                <span style={{ flex: 1 }} />
                <button className="textbtn" onClick={() => deleteGroup(g)}>Remove group</button>
              </div>
            </section>
          );
        })}
      </div>

      <div className="actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
        <button className="btn ghost" onClick={() => addGroup()}>+ Add group</button>
        <button className="btn ghost" onClick={() => setPicker("new-group")}>+ Add a catalog group</button>
        {props.templates.length > 0 && (
          <select className="btn ghost" value="" disabled={pending} aria-label="Add a budget template" onChange={(e) => e.target.value && run(() => addBudgetTemplate(props.projectId, e.target.value))}>
            <option value="">+ Add a budget template…</option>
            {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {groups.length > 0 && props.unlinkedDocs && <button className="textbtn" disabled={pending} onClick={() => run(() => buildBudgetFromDocuments(props.projectId))}>Add lines from this job&apos;s documents</button>}
      </div>
      <p className="fine">Unit costs, profit and margin are only for you. Changing a line here also changes it on draft and pending documents; signed documents never change.</p>

      {picker && (
        <CatalogPicker
          mode={picker === "new-group" ? "groups" : "items"}
          catalog={props.catalog}
          unitAbbr={unitAbbr}
          onClose={() => setPicker(null)}
          onPickItem={(c) => { addItems(picker, [c]); }}
          onPickGroup={async (cg) => { setPicker(null); const id = await addGroup(cg.name, cg.description); const its = props.catalog.items.filter((x) => x.cost_group_id === cg.id); if (id && its.length) await addItems(id, its); }}
        />
      )}
      {linking && (() => {
        const it = items.find((i) => i.id === linking)!;
        return (
          <LinkDialog
            item={it as never}
            unit={unitAbbr(it.unit_id)}
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
