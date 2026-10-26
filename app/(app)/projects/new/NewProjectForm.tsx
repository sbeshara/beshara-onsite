"use client";

import { useActionState } from "react";
import { createProject, type Result } from "@/app/actions";
import type { Profile } from "@/lib/types";

export default function NewProjectForm({ staff }: { staff: Profile[] }) {
  const [state, action, pending] = useActionState<Result, FormData>(createProject, {});
  return (
    <form className="form" action={action}>
      <label className="field">
        Project name
        <input name="name" required autoComplete="off" placeholder="e.g. Maple Family Dentistry" />
      </label>
      <div className="row2">
        <label className="field">
          Town
          <input name="town" required autoComplete="off" placeholder="e.g. Morristown" />
        </label>
        <label className="field">
          Scope
          <input name="scope" autoComplete="off" placeholder="e.g. 2,000 sf · 5 operatories" />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          Client name
          <input name="client_name" required autoComplete="off" placeholder="e.g. Dr. Sam Patel" />
        </label>
        <label className="field">
          Client email
          <input name="client_email" type="email" required autoComplete="off" placeholder="name@practice.com" />
        </label>
      </div>
      <h3 className="mh">Construction management on this job</h3>
      <div className="opts">
        {staff.length ? (
          staff.map((p) => (
            <label key={p.id} className="opt">
              <input type="checkbox" name="staff" value={p.id} />
              <span><b>{p.full_name || p.email}</b><small>Construction Management</small></span>
            </label>
          ))
        ) : (
          <p className="fine">No one on Construction Management yet. Invite them from the Team page, then assign them here or later.</p>
        )}
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Creating…" : "Create project and invite client"}</button>
      </div>
    </form>
  );
}
