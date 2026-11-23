"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { CLIENT_VIEWS, docNumber, STATUS_LABEL, totals, type EstGroup, type EstItem, type EstStep } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { KIND_UNIT, fmtQty, linkedQuantity, type MeasureKind } from "@/lib/takeoff";
import { deleteEstimate, recallEstimate, sendEstimate } from "@/app/(app)/office/actions";

type Opt = { id: number; name: string; abbr?: string };
type CatGroup = { id: string; name: string; parent_id: string | null; description: string };
type CatItem = { id: string; cost_group_id: string | null; name: string; description: string; cost_type_id: number | null; unit_id: number | null; quantity: number | null; unit_cost: number | null; unit_price: number | null };
type MeasureOpt = { id: string; name: string; kind: MeasureKind; sheet: string; value: number | null };

const money = (v: number | string | null) => (Number(v) || 0).toFixed(2);
// A textarea that grows to show all of its text.
const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };

const num = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export default function EstimateEditor(props: {
  projectId: string; jobNumber: string | null; chats: { id: string; name: string }[];
  estimate: { id: string; seq: number; kind: string; name: string; status: string; intro: string; terms: string; issued_on: string; signed_at: string | null; signed_by_name: string | null; sent_at: string | null; signature: string | null; declined_at: string | null; decline_reason: string | null };
  groups: EstGroup[]; items: EstItem[]; steps: EstStep[];
  catalog: { groups: CatGroup[]; items: CatItem[] }; types: Opt[]; units: Opt[]; measures: MeasureOpt[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [est, setEst] = useState(props.estimate);
  const [groups, setGroups] = useState(props.groups);
  const [items, setItems] = useState(props.items);
  const [steps, setSteps] = useState(props.steps);
  const [picker, setPicker] = useState<string | null>(null); // group id when adding from the catalog
  const [linking, setLinking] = useState<string | null>(null); // item id being linked to a takeoff
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, start] = useTransition();
  const locked = est.status === "approved";
  const unitAbbr = (id: number | null) => props.units.find((u) => u.id === id)?.abbr ?? "";
  const typeName = (id: number | null) => props.types.find((t) => t.id === id)?.name ?? "";
  const measure = (id: string | null) => props.measures.find((m) => m.id === id) ?? null;

  const qty = (it: EstItem) => {
    const m = measure(it.measurement_id);
    return it.measurement_id && m ? linkedQuantity(m.value, Number(it.qty_factor), Number(it.waste_pct)) : Number(it.quantity) || 0;
  };
  const sum = totals(items.map((i) => ({ q: qty(i), c: Number(i.unit_cost), p: Number(i.unit_price) })));
  const groupSum = (gid: string) => totals(items.filter((i) => i.group_id === gid).map((i) => ({ q: qty(i), c: Number(i.unit_cost), p: Number(i.unit_price) })));
  const stepTotal = steps.reduce((s, x) => s + Number(x.percent), 0);

  async function save(table: string, id: string, patch: Record<string, unknown>) {
    setError("");
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) setError(error.message.includes("locked") ? error.message : "Couldn't save that change. Try again.");
    else { setSaved("Saved"); setTimeout(() => setSaved(""), 1500); }
  }
  const patchItem = (id: string, patch: Partial<EstItem>, persist = true) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    if (persist) save("estimate_items", id, patch);
  };
  const patchGroup = (id: string, patch: Partial<EstGroup>) => {
    setGroups((all) => all.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    save("estimate_groups", id, patch);
  };

  async function addGroup() {
    const { data, error } = await supabase
      .from("estimate_groups")
      .insert({ estimate_id: est.id, name: "New group", position: groups.length, client_view: est.kind === "Proposal" ? "total" : "items" })
      .select("id, name, description, client_view, display_qty, display_unit, position")
      .single();
    if (error || !data) return setError("Couldn't add a group. Try again.");
    setGroups((g) => [...g, data as EstGroup]);
  }
  async function addCatalogGroup(cg: CatGroup) {
    const { data: g, error } = await supabase
      .from("estimate_groups")
      .insert({ estimate_id: est.id, name: cg.name, description: cg.description, position: groups.length, client_view: est.kind === "Proposal" ? "total" : "items" })
      .select("id, name, description, client_view, display_qty, display_unit, position")
      .single();
    if (error || !g) return setError("Couldn't add that group. Try again.");
    setGroups((all) => [...all, g as EstGroup]);
    const its = props.catalog.items.filter((x) => x.cost_group_id === cg.id);
    if (its.length) await addItems(g.id, its);
  }
  async function deleteGroup(id: string) {
    setGroups((g) => g.filter((x) => x.id !== id));
    setItems((all) => all.filter((i) => i.group_id !== id));
    const { error } = await supabase.from("estimate_groups").delete().eq("id", id);
    if (error) setError("Couldn't remove the group. Reload and try again.");
  }
  async function addItems(groupId: string, list: (CatItem | null)[]) {
    const base = items.filter((i) => i.group_id === groupId).length;
    const rows = list.map((c, n) => ({
      estimate_id: est.id, group_id: groupId, catalog_item_id: c?.id ?? null, name: c?.name ?? "New item", description: c?.description ?? "",
      cost_type_id: c?.cost_type_id ?? props.types[0]?.id ?? null, unit_id: c?.unit_id ?? props.units[0]?.id ?? null,
      quantity: c?.quantity ?? (c ? 0 : 1), unit_cost: c?.unit_cost ?? 0, unit_price: c?.unit_price ?? 0, position: base + n,
    }));
    const { data, error } = await supabase
      .from("estimate_items")
      .insert(rows)
      .select("id, group_id, catalog_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position");
    if (error || !data) return setError("Couldn't add the item. Try again.");
    setItems((all) => [...all, ...(data as EstItem[])]);
  }
  async function deleteItem(id: string) {
    setItems((all) => all.filter((i) => i.id !== id));
    const { error } = await supabase.from("estimate_items").delete().eq("id", id);
    if (error) setError("Couldn't remove the item. Reload and try again.");
  }
  function link(it: EstItem, measurementId: string | null, factor: number, waste: number) {
    const m = measure(measurementId);
    const q = m ? linkedQuantity(m.value, factor, waste) : qty(it);
    patchItem(it.id, { measurement_id: measurementId, qty_factor: factor, waste_pct: waste, quantity: Math.round(q * 100) / 100 });
  }
  async function addStep() {
    const { data } = await supabase.from("estimate_payment_steps").insert({ estimate_id: est.id, name: "New step", percent: 0, position: steps.length }).select("id, name, percent, position").single();
    if (data) setSteps((s) => [...s, data as EstStep]);
  }
  async function deleteStep(id: string) {
    setSteps((s) => s.filter((x) => x.id !== id));
    await supabase.from("estimate_payment_steps").delete().eq("id", id);
  }

  const number = docNumber(props.jobNumber, est.seq);
  return (
    <div className="page est">
      <div className="est-bar">
        <Link className="textbtn" href={`/projects/${props.projectId}/estimates`}>← Documents</Link>
        <input
          className="est-title"
          defaultValue={est.name}
          aria-label="Estimate name"
          readOnly={locked}
          onBlur={(e) => e.target.value.trim() && e.target.value !== est.name && (setEst({ ...est, name: e.target.value.trim() }), save("estimates", est.id, { name: e.target.value.trim() }))}
        />
        <span className="fine">{est.kind} {number}</span>
        <span className="pill">{STATUS_LABEL[est.status]}</span>
        <span className="fine" aria-live="polite">{saved}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Link className="btn ghost" href={`/projects/${props.projectId}/estimates/${est.id}/preview`}>Preview client copy</Link>
          {est.status === "pending" && (
            <button className="btn ghost" disabled={pending} onClick={() => start(async () => { const r = await recallEstimate(est.id, props.projectId); if (r.error) setError(r.error); else { setEst({ ...est, status: "draft" }); setNote(r.ok ?? ""); } })}>Take back</button>
          )}
          {!locked && <button className="btn" onClick={() => setSending(true)}>{est.status === "pending" ? "Resend" : "Send for signature"}</button>}
        </span>
      </div>
      {locked && (
        <div className="signedbox">
          {est.signature && <img src={est.signature} alt={`Signature of ${est.signed_by_name}`} />}
          <div><b>Signed by {est.signed_by_name}</b>{est.signed_at && <small>{new Date(est.signed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</small>}<small>Signed estimates are locked. Add a change order to change the scope.</small></div>
        </div>
      )}
      {est.status === "pending" && <p className="clientnote">Sent {est.sent_at ? new Date(est.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}, waiting for the client&apos;s signature. They see the version you sent: if you change anything, press Resend.</p>}
      {est.status === "denied" && <p className="err">Declined by the client{est.declined_at ? ` on ${new Date(est.declined_at).toLocaleDateString()}` : ""}{est.decline_reason ? `: "${est.decline_reason}"` : "."} Edit it and send it again, or start a new one.</p>}
      {note && <p className="ok" role="status">{note}</p>}
      {error && <p className="err" role="alert">{error}</p>}

      <div className="est-grid">
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          {groups.map((g) => {
            const gs = groupSum(g.id);
            const gItems = items.filter((i) => i.group_id === g.id).sort((a, b) => a.position - b.position);
            return (
              <section key={g.id} className="est-group">
                <div className="est-gh">
                  <input defaultValue={g.name} aria-label="Group name" readOnly={locked} onBlur={(e) => e.target.value !== g.name && patchGroup(g.id, { name: e.target.value })} />
                  <select value={g.client_view} disabled={locked} aria-label="What the client sees" onChange={(e) => patchGroup(g.id, { client_view: e.target.value as EstGroup["client_view"] })}>
                    {Object.entries(CLIENT_VIEWS).map(([k, v]) => <option key={k} value={k}>Client sees: {v}</option>)}
                  </select>
                  <b className="num">{usd(gs.price)}</b>
                </div>
                {g.client_view === "total" && (
                  <div className="est-showas">
                    Client sees it as
                    <input inputMode="decimal" defaultValue={g.display_qty ?? ""} placeholder="1" aria-label="Quantity shown" readOnly={locked}
                      onBlur={(e) => patchGroup(g.id, { display_qty: e.target.value.trim() ? num(e.target.value) : null })} />
                    <select value={g.display_unit ?? "LS"} disabled={locked} aria-label="Unit shown" onChange={(e) => patchGroup(g.id, { display_unit: e.target.value === "LS" ? null : e.target.value })}>
                      {["LS", "SF", "LF", "EA"].map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <span>{g.display_unit && g.display_qty ? `at ${usd(gs.price / g.display_qty, true)} / ${g.display_unit}` : "Lump sum"}</span>
                  </div>
                )}
                <label className="est-desc">
                  <span>Description the client reads</span>
                  <textarea ref={grow} onInput={(e) => grow(e.currentTarget)} defaultValue={g.description} rows={2} readOnly={locked} onBlur={(e) => e.target.value !== g.description && patchGroup(g.id, { description: e.target.value })} />
                </label>
                <div className="otable-wrap">
                  <table className="otable est-items">
                    <thead><tr><th>Item</th><th>Type</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit cost</th><th className="r">Unit price</th><th className="r">Total</th>{!locked && <th />}</tr></thead>
                    <tbody>
                      {gItems.map((it) => {
                        const q = qty(it), m = measure(it.measurement_id);
                        return (
                          <tr key={it.id}>
                            <td>
                              <textarea className="ei-name" ref={grow} onInput={(e) => grow(e.currentTarget)} rows={1} defaultValue={it.name} aria-label="Item name" readOnly={locked} onBlur={(e) => e.target.value !== it.name && patchItem(it.id, { name: e.target.value })} />
                              <textarea className="ei-desc" ref={grow} onInput={(e) => grow(e.currentTarget)} rows={1} defaultValue={it.description} placeholder={locked ? "" : "Description (optional)"} aria-label="Item description" readOnly={locked} onBlur={(e) => e.target.value !== it.description && patchItem(it.id, { description: e.target.value })} />
                              {it.measurement_id && (
                                <small className="ei-link">
                                  {m ? `📐 ${m.name} ${m.value == null ? "(sheet not scaled)" : fmtQty(m.value, KIND_UNIT[m.kind])} × ${it.qty_factor}${Number(it.waste_pct) ? ` + ${it.waste_pct}% waste` : ""}` : "📐 Takeoff was deleted; using the last quantity"}
                                </small>
                              )}
                            </td>
                            <td><span className="ctype">{typeName(it.cost_type_id)}</span></td>
                            <td className="r">
                              {it.measurement_id && m ? (
                                <button className="ei-qty linked" onClick={() => !locked && setLinking(it.id)} title="From takeoff. Click to change.">{fmtQty(q)}</button>
                              ) : (
                                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                  <input className="ei-num" defaultValue={it.quantity} inputMode="decimal" aria-label="Quantity" readOnly={locked}
                                    onChange={(e) => patchItem(it.id, { quantity: num(e.target.value) }, false)}
                                    onBlur={(e) => save("estimate_items", it.id, { quantity: num(e.target.value) })} />
                                  {!locked && <button className="ei-take" onClick={() => setLinking(it.id)} title="Take the quantity from a plan takeoff" aria-label="Link to a takeoff">📐</button>}
                                </span>
                              )}
                            </td>
                            <td>
                              <select className="ei-unit" value={it.unit_id ?? ""} disabled={locked} aria-label="Unit" onChange={(e) => patchItem(it.id, { unit_id: Number(e.target.value) || null })}>
                                {props.units.map((u) => <option key={u.id} value={u.id}>{u.abbr}</option>)}
                              </select>
                            </td>
                            <td className="r"><span className="ei-money">$<input className="ei-num" defaultValue={money(it.unit_cost)} inputMode="decimal" aria-label="Unit cost" readOnly={locked} onChange={(e) => patchItem(it.id, { unit_cost: num(e.target.value) }, false)} onBlur={(e) => { e.target.value = money(num(e.target.value)); save("estimate_items", it.id, { unit_cost: num(e.target.value) }); }} /></span></td>
                            <td className="r"><span className="ei-money">$<input className="ei-num" defaultValue={money(it.unit_price)} inputMode="decimal" aria-label="Unit price" readOnly={locked} onChange={(e) => patchItem(it.id, { unit_price: num(e.target.value) }, false)} onBlur={(e) => { e.target.value = money(num(e.target.value)); save("estimate_items", it.id, { unit_price: num(e.target.value) }); }} /></span></td>
                            <td className="r"><b>{usd(q * Number(it.unit_price))}</b></td>
                            {!locked && <td><button className="ei-x" onClick={() => deleteItem(it.id)} aria-label={`Remove ${it.name}`}>×</button></td>}
                          </tr>
                        );
                      })}
                      {!gItems.length && <tr><td colSpan={8} className="fine">No items yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {!locked && (
                  <div className="est-gf">
                    <button className="linkbtn" onClick={() => setPicker(g.id)}>+ Add from catalog</button>
                    <button className="textbtn" onClick={() => addItems(g.id, [null])}>+ Custom item</button>
                    <span style={{ flex: 1 }} />
                    <button className="textbtn" onClick={() => deleteGroup(g.id)}>Remove group</button>
                  </div>
                )}
              </section>
            );
          })}
          {!locked && (
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn ghost" onClick={addGroup}>+ Add group</button>
              <button className="btn ghost" onClick={() => setPicker("new-group")}>+ Add a catalog group</button>
            </div>
          )}
        </div>

        <aside className="est-side">
          <section className="ocard">
            <h2>Summary</h2>
            <div className="sumrow"><span>Cost</span><b className="num">{usd(sum.cost)}</b></div>
            <div className="sumrow"><span>Profit</span><b className="num">{usd(sum.profit)}</b></div>
            <div className="sumrow"><span>Margin</span><b className={`num ${sum.margin < 25 && sum.price ? "margin-lo" : ""}`}>{sum.price ? `${sum.margin.toFixed(1)}%` : "—"}</b></div>
            <div className="sumrow big"><span>Client price</span><b className="num">{usd(sum.price)}</b></div>
            <p className="fine">Cost, profit and margin never show on the client&apos;s copy.</p>
          </section>
          <section className="ocard">
            <div className="sec-h" style={{ marginBottom: 0 }}><h2>Payment schedule</h2>{!locked && <button className="textbtn" onClick={addStep}>+ Step</button>}</div>
            <p className="fine">Invoices are made from these steps.</p>
            {steps.map((s) => (
              <div key={s.id} className="est-step">
                <input defaultValue={s.name} aria-label="Step name" readOnly={locked} onBlur={(e) => e.target.value !== s.name && save("estimate_payment_steps", s.id, { name: e.target.value })} />
                <input className="pct" defaultValue={s.percent} inputMode="decimal" aria-label="Percent" readOnly={locked}
                  onChange={(e) => setSteps((all) => all.map((x) => (x.id === s.id ? { ...x, percent: num(e.target.value) } : x)))}
                  onBlur={(e) => save("estimate_payment_steps", s.id, { percent: num(e.target.value) })} />
                <span className="num">{usd((sum.price * Number(s.percent)) / 100)}</span>
                {!locked && <button className="ei-x" onClick={() => deleteStep(s.id)} aria-label={`Remove ${s.name}`}>×</button>}
              </div>
            ))}
            {Math.abs(stepTotal - 100) > 0.01 && <p className="err">Steps add up to {stepTotal}%. They need to total 100%.</p>}
          </section>
          <section className="ocard">
            <h2>Intro &amp; terms</h2>
            <label className="field">Intro<textarea rows={3} defaultValue={est.intro} readOnly={locked} placeholder="Optional note at the top of the client's copy" onBlur={(e) => save("estimates", est.id, { intro: e.target.value })} /></label>
            <label className="field">Terms<textarea rows={4} defaultValue={est.terms} readOnly={locked} placeholder="Validity, exclusions, payment terms" onBlur={(e) => save("estimates", est.id, { terms: e.target.value })} /></label>
          </section>
          {!locked && (
            <button className="textbtn" style={{ color: "#B3261E", justifySelf: "start" }} disabled={pending} onClick={() => start(async () => { const r = await deleteEstimate(est.id, props.projectId); if (r?.error) setError(r.error); })}>
              Delete this estimate
            </button>
          )}
        </aside>
      </div>

      {sending && (
        <SendDialog
          kind={est.kind}
          chats={props.chats}
          resend={est.status === "pending"}
          onClose={() => setSending(false)}
          onSend={(chat, msg) => start(async () => {
            const r = await sendEstimate(est.id, props.projectId, chat, msg);
            if (r.error) setError(r.error);
            else { setEst({ ...est, status: "pending", sent_at: new Date().toISOString() }); setNote(r.ok ?? ""); setSending(false); }
          })}
          busy={pending}
        />
      )}
      {picker && (
        <CatalogPicker
          mode={picker === "new-group" ? "groups" : "items"}
          catalog={props.catalog}
          unitAbbr={unitAbbr}
          onClose={() => setPicker(null)}
          onPickItem={(c) => { addItems(picker, [c]); }}
          onPickGroup={(g) => { addCatalogGroup(g); setPicker(null); }}
        />
      )}
      {linking && (() => {
        const it = items.find((i) => i.id === linking)!;
        return <LinkDialog item={it} unit={unitAbbr(it.unit_id)} measures={props.measures} projectId={props.projectId} onClose={() => setLinking(null)} onSave={(mid, f, w) => { link(it, mid, f, w); setLinking(null); }} />;
      })()}
    </div>
  );
}

function CatalogPicker({ mode, catalog, unitAbbr, onClose, onPickItem, onPickGroup }: {
  mode: "items" | "groups"; catalog: { groups: CatGroup[]; items: CatItem[] }; unitAbbr: (id: number | null) => string;
  onClose: () => void; onPickItem: (c: CatItem) => void; onPickGroup: (g: CatGroup) => void;
}) {
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const needle = q.trim().toLowerCase();
  const gname = (id: string | null) => catalog.groups.find((g) => g.id === id)?.name ?? "No group";
  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Catalog" style={{ maxWidth: 620, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div className="sec-h"><h2>{mode === "groups" ? "Add a catalog group" : "Add from catalog"}</h2><button className="textbtn" onClick={onClose}>Done</button></div>
        <input className="osearch" style={{ width: "100%" }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search the catalog" />
        <div style={{ overflow: "auto", display: "grid", gap: 6, marginTop: 10 }}>
          {mode === "groups"
            ? catalog.groups.filter((g) => !needle || g.name.toLowerCase().includes(needle)).map((g) => (
                <button key={g.id} className="cat-pick" onClick={() => onPickGroup(g)}>
                  <span><b>{g.name}</b><small>{catalog.items.filter((i) => i.cost_group_id === g.id).length} items{g.parent_id ? ` · in ${gname(g.parent_id)}` : ""}</small></span>
                </button>
              ))
            : catalog.items.filter((i) => !needle || `${i.name} ${i.description} ${gname(i.cost_group_id)}`.toLowerCase().includes(needle)).slice(0, 200).map((i) => (
                <button key={i.id} className="cat-pick" onClick={() => { onPickItem(i); setAdded((a) => [...a, i.id]); }}>
                  <span><b>{i.name}</b><small>{gname(i.cost_group_id)} · {unitAbbr(i.unit_id)}</small></span>
                  <span className="num">{usd(i.unit_price ?? 0, true)}</span>
                  {added.includes(i.id) && <span className="ok">Added</span>}
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}

function LinkDialog({ item, unit, measures, projectId, onClose, onSave }: {
  item: EstItem; unit: string; measures: MeasureOpt[]; projectId: string; onClose: () => void; onSave: (mid: string | null, factor: number, waste: number) => void;
}) {
  const [mid, setMid] = useState(item.measurement_id ?? measures[0]?.id ?? "");
  const [factor, setFactor] = useState(String(item.qty_factor ?? 1));
  const [waste, setWaste] = useState(String(item.waste_pct ?? 0));
  const m = measures.find((x) => x.id === mid);
  const q = m ? linkedQuantity(m.value, num(factor), num(waste)) : 0;
  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Quantity from takeoff" style={{ maxWidth: 480 }}>
        <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 500 }}>Quantity from a takeoff</h2>
        <p className="fine">{item.name}</p>
        {measures.length ? (
          <div className="form" style={{ maxWidth: "none" }}>
            <label className="field">
              Takeoff
              <select value={mid} onChange={(e) => setMid(e.target.value)}>
                {measures.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.value == null ? "not scaled" : fmtQty(x.value, KIND_UNIT[x.kind])} · {x.sheet}</option>)}
              </select>
            </label>
            <div className="row2">
              <label className="field">Multiply by<input value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="decimal" /></label>
              <label className="field">Waste %<input value={waste} onChange={(e) => setWaste(e.target.value)} inputMode="decimal" /></label>
            </div>
            <p className="fine">E.g. wall length × 10 for wall area at 10&apos; high, × 20 for drywall on both sides.</p>
            <p><b>{m ? `${m.value == null ? "?" : fmtQty(m.value, KIND_UNIT[m.kind])} × ${factor}${num(waste) ? ` × ${1 + num(waste) / 100}` : ""} = ${fmtQty(q)} ${unit}` : ""}</b></p>
            <div className="actions">
              {item.measurement_id && <button className="btn ghost" onClick={() => onSave(null, 1, 0)}>Unlink (type it in)</button>}
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn" onClick={() => onSave(mid || null, num(factor) || 1, num(waste))} disabled={!mid}>Use this quantity</button>
            </div>
          </div>
        ) : (
          <>
            <p>There are no takeoffs on this job yet.</p>
            <div className="actions"><button className="btn ghost" onClick={onClose}>Close</button><Link className="btn" href={`/projects/${projectId}/plans`}>Open Plans &amp; Takeoff</Link></div>
          </>
        )}
      </div>
    </div>
  );
}

function SendDialog({ kind, chats, resend, busy, onClose, onSend }: { kind: string; chats: { id: string; name: string }[]; resend: boolean; busy: boolean; onClose: () => void; onSend: (chat: string | null, msg: string) => void }) {
  const [chat, setChat] = useState(chats[0]?.id ?? "");
  const [msg, setMsg] = useState(resend ? `I've updated your ${kind.toLowerCase()}. Please review and sign the new version.` : `Your ${kind.toLowerCase()} is ready to review and sign.`);
  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send for signature" style={{ maxWidth: 480 }}>
        <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 500 }}>{resend ? "Resend for signature" : "Send for signature"}</h2>
        <p className="fine">The client reviews and signs it in OnSite, under Proposals on their project. What they see is frozen now: later edits need a resend.</p>
        <div className="form" style={{ maxWidth: "none" }}>
          <label className="field">
            Tell them in
            <select value={chat} onChange={(e) => setChat(e.target.value)}>
              {chats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="">Don&apos;t post a message</option>
            </select>
          </label>
          {chat && <label className="field">Message<textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>}
          <div className="actions">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={busy} onClick={() => onSend(chat || null, msg)}>{busy ? "Sending…" : resend ? "Resend" : "Send"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
