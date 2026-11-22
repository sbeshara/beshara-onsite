"use client";

import { useActionState, useState } from "react";
import { createEstimate, type Result } from "@/app/(app)/office/actions";

type Template = { id: string; name: string; groups: string[]; items: number };
type DocTemplate = { id: string; name: string; kind: string; intro: string };

// New estimate in three steps: the document template (type, intro and terms),
// then the budget (a catalog template or blank), then the name.
export default function NewEstimate({ projectId, templates, docTemplates, hasProposal }: { projectId: string; templates: Template[]; docTemplates: DocTemplate[]; hasProposal: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(createEstimate, {});
  const [doc, setDoc] = useState<DocTemplate | { id: ""; name: string; kind: string; intro: "" } | null>(null);
  const [budget, setBudget] = useState<string | null>(null); // "" = blank
  const chosen = templates.find((t) => t.id === budget);
  const blankKinds = ["Proposal", "Change Order", "Additional Scope"];
  // Change orders and additional scope come first once a proposal exists.
  const docs = [...docTemplates].sort((a, b) => (hasProposal ? Number(a.kind === "Proposal") - Number(b.kind === "Proposal") : Number(b.kind === "Proposal") - Number(a.kind === "Proposal")));

  if (!doc) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p className="fine">Step 1 of 3: which document? It sets the type, the intro and the terms.</p>
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

  if (budget === null) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p className="fine">
          Step 2 of 3 · <b style={{ color: "var(--ink)" }}>{doc.name}</b>{" "}
          <button type="button" className="textbtn" onClick={() => setDoc(null)}>Change</button>
          <br />Which budget should it start from? Its cost groups, client descriptions and line items come in, ready for quantities.
        </p>
        <div className="tpl-grid">
          {templates.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => setBudget(t.id)}>
              <b>{t.name}</b>
              <small>{t.groups.length} groups · {t.items} items</small>
              <span>{t.groups.slice(0, 6).join(" · ")}{t.groups.length > 6 ? " …" : ""}</span>
            </button>
          ))}
          <button type="button" className="tpl blank" onClick={() => setBudget("")}>
            <b>Blank</b>
            <small>Start with one empty group</small>
            <span>Add groups and items from the catalog as you go.</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="form" action={action} style={{ maxWidth: 620 }}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="template" value={budget} />
      <input type="hidden" name="doc_template" value={doc.id} />
      <input type="hidden" name="kind" value={doc.kind} />
      <p className="fine">
        Step 3 of 3 · <b style={{ color: "var(--ink)" }}>{doc.name}</b> with {chosen ? <b style={{ color: "var(--ink)" }}>{chosen.name}</b> : "a blank budget"}.{" "}
        <button type="button" className="textbtn" onClick={() => setBudget(null)}>Change</button>
      </p>
      <label className="field">
        Name
        <input name="name" defaultValue={doc.id ? doc.name : chosen ? `${chosen.name} ${doc.kind}` : doc.kind} />
      </label>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Creating…" : `Create ${doc.kind.toLowerCase()}`}</button>
      </div>
    </form>
  );
}
