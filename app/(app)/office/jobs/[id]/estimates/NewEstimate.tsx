"use client";

import { useActionState, useState } from "react";
import { createEstimate, type Result } from "../../../actions";

type Template = { id: string; name: string; groups: string[]; items: number };

// New estimate: pick the budget template first, then the type and name.
export default function NewEstimate({ projectId, templates, hasProposal }: { projectId: string; templates: Template[]; hasProposal: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(createEstimate, {});
  const [template, setTemplate] = useState<string | null>(null); // "" = blank
  const [kind, setKind] = useState(hasProposal ? "Change Order" : "Proposal");
  const chosen = templates.find((t) => t.id === template);

  if (template === null) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p className="fine">Step 1 of 2: which budget should it start from? Its cost groups, client descriptions and line items come in, ready for quantities.</p>
        <div className="tpl-grid">
          {templates.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => setTemplate(t.id)}>
              <b>{t.name}</b>
              <small>{t.groups.length} groups · {t.items} items</small>
              <span>{t.groups.slice(0, 6).join(" · ")}{t.groups.length > 6 ? " …" : ""}</span>
            </button>
          ))}
          <button type="button" className="tpl blank" onClick={() => setTemplate("")}>
            <b>Blank</b>
            <small>Start with one empty group</small>
            <span>Add groups and items from the catalog as you go.</span>
          </button>
        </div>
        {!templates.length && <p className="fine">No templates yet. In the catalog, a cost group that holds other groups (like an Interior Fit-Out with its trades) works as a template.</p>}
      </div>
    );
  }

  return (
    <form className="form" action={action} style={{ maxWidth: 620 }}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="template" value={template} />
      <p className="fine">
        Step 2 of 2 · Starting from <b style={{ color: "var(--ink)" }}>{chosen ? chosen.name : "a blank estimate"}</b>{chosen ? ` (${chosen.groups.length} groups, ${chosen.items} items)` : ""}.{" "}
        <button type="button" className="textbtn" onClick={() => setTemplate(null)}>Change</button>
      </p>
      <div className="row2">
        <label className="field">
          Type
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option>Proposal</option>
            <option>Change Order</option>
            <option>Additional Scope</option>
          </select>
        </label>
        <label className="field">
          Name
          <input name="name" placeholder={chosen ? `${chosen.name} ${kind}` : kind} defaultValue={chosen ? `${chosen.name} ${kind}` : ""} />
        </label>
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Creating…" : `Create ${kind.toLowerCase()}`}</button>
      </div>
    </form>
  );
}
