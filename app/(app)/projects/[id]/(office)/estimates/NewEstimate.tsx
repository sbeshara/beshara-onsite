"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createEstimate, type Result } from "@/app/(app)/office/actions";

export type BudgetPick = { id: string; name: string; items: { id: string; name: string; price: number; docs: { label: string; status: string }[] }[] };
type DocTemplate = { id: string; name: string; kind: string; intro: string };

// New document in two steps: the document template (type, intro and terms),
// then the budget lines to include and the name.
export default function NewEstimate({ projectId, budget, docTemplates, hasProposal }: { projectId: string; budget: BudgetPick[]; docTemplates: DocTemplate[]; hasProposal: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(createEstimate, {});
  const [doc, setDoc] = useState<DocTemplate | { id: ""; name: string; kind: string; intro: "" } | null>(null);
  const blankKinds = ["Proposal", "Change Order", "Additional Scope"];
  // Change orders and additional scope come first once a proposal exists.
  const docs = [...docTemplates].sort((a, b) => (hasProposal ? Number(a.kind === "Proposal") - Number(b.kind === "Proposal") : Number(b.kind === "Proposal") - Number(a.kind === "Proposal")));

  if (!doc) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p className="fine">Step 1 of 2: which document? It sets the type, the intro and the terms.</p>
        <div className="tpl-grid">
          {docs.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => setDoc(t)}>
              <b>{t.name}</b>
              <small>{t.kind}</small>
              <span>{t.intro ? `${t.intro.replace(/[*_#]/g, "").slice(0, 110)}…` : "No intro text"}</span>
            </button>
          ))}
          {blankKinds.map((k) => (
            <button key={k} type="button" className="tpl blank" onClick={() => setDoc({ id: "", name: k, kind: k, intro: "" })}>
              <b>Blank {k.toLowerCase()}</b>
              <small>{k}</small>
              <span>No intro or terms; write your own.</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return <PickLines key={doc.id + doc.kind} projectId={projectId} doc={doc} budget={budget} action={action} pending={pending} error={state.error} onBack={() => setDoc(null)} />;
}

// Step 2: tick the budget lines to include, then name it. Lines already on a
// signed or pending document start unticked, so a change order picks up only
// what's new.
function PickLines({ projectId, doc, budget, action, pending, error, onBack }: {
  projectId: string; doc: { id: string; name: string; kind: string }; budget: BudgetPick[];
  action: (f: FormData) => void; pending: boolean; error?: string; onBack: () => void;
}) {
  const fresh = (it: BudgetPick["items"][number]) => !it.docs.some((d) => d.status === "approved" || d.status === "pending");
  const [on, setOn] = useState<Set<string>>(() => new Set(budget.flatMap((g) => g.items.filter(fresh).map((i) => i.id))));
  const flip = (ids: string[], v: boolean) => setOn((s) => { const n = new Set(s); ids.forEach((id) => (v ? n.add(id) : n.delete(id))); return n; });
  const total = budget.flatMap((g) => g.items).filter((i) => on.has(i.id)).reduce((s, i) => s + i.price, 0);
  const cur = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <form className="form" action={action} style={{ maxWidth: "none" }}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="doc_template" value={doc.id} />
      <input type="hidden" name="kind" value={doc.kind} />
      {[...on].map((id) => <input key={id} type="hidden" name="item" value={id} />)}
      <p className="fine">
        Step 2 of 2 · <b style={{ color: "var(--ink)" }}>{doc.name}</b>{" "}
        <button type="button" className="textbtn" onClick={onBack}>Change</button>
        <br />Tick what to include from the budget. Lines already on a signed or pending document start unticked.
      </p>
      {budget.length ? (
        <div className="pick">
          {budget.map((g) => {
            const ids = g.items.map((i) => i.id);
            const n = ids.filter((id) => on.has(id)).length;
            return (
              <div key={g.id} className="pick-g">
                <label className="pick-gh">
                  <input type="checkbox" checked={n > 0 && n === ids.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }} onChange={(e) => flip(ids, e.target.checked)} disabled={!ids.length} />
                  <b>{g.name}</b>
                  <span className="r">{cur(g.items.filter((i) => on.has(i.id)).reduce((s, i) => s + i.price, 0))}</span>
                </label>
                {g.items.map((it) => (
                  <label key={it.id} className="pick-i">
                    <input type="checkbox" checked={on.has(it.id)} onChange={(e) => flip([it.id], e.target.checked)} />
                    <span>{it.name}{it.docs.length > 0 && <small>{it.docs.map((d) => d.label).join(" · ")}</small>}</span>
                    <span className="r">{cur(it.price)}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="fine">This job&apos;s budget is empty. <Link href={`/projects/${projectId}/budget`}>Build the budget</Link> first, or create it blank and add items as you go (they go into the budget too).</p>
      )}
      <div className="row2" style={{ alignItems: "end" }}>
        <label className="field">
          Name
          <input name="name" defaultValue={doc.id ? doc.name : doc.kind} />
        </label>
        <p className="fine" style={{ margin: 0 }}>{on.size} {on.size === 1 ? "line" : "lines"} · <b style={{ color: "var(--ink)" }}>{cur(total)}</b></p>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Creating…" : on.size ? `Create ${doc.kind.toLowerCase()}` : `Create a blank ${doc.kind.toLowerCase()}`}</button>
      </div>
    </form>
  );
}
