"use client";

import { useActionState, useState } from "react";
import { createEstimate, type Result } from "../../../actions";

export default function NewEstimate({ projectId, templates, hasProposal }: { projectId: string; templates: { id: string; name: string }[]; hasProposal: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(createEstimate, {});
  const [kind, setKind] = useState(hasProposal ? "Change Order" : "Proposal");
  return (
    <form className="form" action={action} style={{ maxWidth: "none" }}>
      <input type="hidden" name="project_id" value={projectId} />
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
          <input name="name" placeholder={kind === "Proposal" ? "e.g. Interior Fit-Out Proposal" : kind} />
        </label>
      </div>
      <label className="field">
        Start from
        <select name="template" defaultValue="">
          <option value="">A blank group</option>
          {templates.map((t) => <option key={t.id} value={t.id}>Catalog template: {t.name}</option>)}
        </select>
      </label>
      <p className="fine">A template copies its cost groups, client descriptions and items. Quantities start at 0 until you type them or link a takeoff.</p>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Creating…" : `Create ${kind.toLowerCase()}`}</button>
      </div>
    </form>
  );
}
