"use client";

import { useActionState } from "react";
import { createLead, updateJob, type Result } from "./actions";
import { JOB_STATUSES, JOB_TYPES, LEAD_STATUSES } from "@/lib/constants";

type Job = {
  id: string;
  name: string;
  status: string;
  job_number: string | null;
  customer_id: string | null;
  job_type: string | null;
  town: string;
  address: string | null;
  notes: string | null;
};

// One form for a new lead and for editing a job's details.
export default function JobForm({ job, customers, presetCustomer }: { job?: Job; customers: { id: string; name: string }[]; presetCustomer?: string }) {
  const [state, action, pending] = useActionState<Result, FormData>(job ? updateJob : createLead, {});
  return (
    <form className="form" action={action} style={{ maxWidth: "none" }}>
      {job && <input type="hidden" name="id" value={job.id} />}
      <label className="field">
        Job name
        <input name="name" required defaultValue={job?.name} placeholder="e.g. Englewood Dentistry: cosmetic renovation" />
      </label>
      <div className="row2">
        <label className="field">
          Customer
          <select name="customer_id" defaultValue={job?.customer_id ?? presetCustomer ?? ""}>
            <option value="">{job ? "No customer" : "New customer (type below)"}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {!job && (
          <label className="field">
            New customer name
            <input name="new_customer" placeholder="Practice or person" autoComplete="off" />
          </label>
        )}
        {job && (
          <label className="field">
            Job number
            <input name="job_number" defaultValue={job.job_number ?? ""} />
          </label>
        )}
      </div>
      <div className="row3">
        <label className="field">
          Status
          <select name="status" defaultValue={job?.status ?? "New Lead"}>
            <optgroup label="Leads">{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</optgroup>
            <optgroup label="Jobs">{JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}</optgroup>
          </select>
        </label>
        <label className="field">
          Job type
          <select name="job_type" defaultValue={job?.job_type ?? ""}>
            <option value="">Not set</option>
            {JOB_TYPES.map((t) => <option key={t}>{t}</option>)}
            {job?.job_type && !(JOB_TYPES as readonly string[]).includes(job.job_type) && <option>{job.job_type}</option>}
          </select>
        </label>
        <label className="field">
          Town
          <input name="town" defaultValue={job?.town} placeholder="e.g. Englewood" />
        </label>
      </div>
      <label className="field">
        Address
        <input name="address" defaultValue={job?.address ?? ""} placeholder="Street, town, state" />
      </label>
      <label className="field">
        Notes
        <textarea name="notes" rows={3} defaultValue={job?.notes ?? ""} placeholder="Size, rooms, special requirements" />
      </label>
      {!job && <p className="fine">The next job number is assigned automatically. No one is invited until you do it from the project.</p>}
      {state.error && <p className="err" role="alert">{state.error}</p>}
      {state.ok && <p className="ok" role="status">{state.ok}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : job ? "Save job" : "Create lead"}</button>
      </div>
    </form>
  );
}
