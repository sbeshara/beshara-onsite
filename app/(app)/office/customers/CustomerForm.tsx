"use client";

import { useActionState } from "react";
import { saveCustomer, type Result } from "../actions";

type Customer = { id: string; name: string; email: string | null; phone: string | null; address: string | null; notes: string | null };

export default function CustomerForm({ customer }: { customer?: Customer }) {
  const [state, action, pending] = useActionState<Result, FormData>(saveCustomer, {});
  return (
    <form className="form" action={action} style={{ maxWidth: "none" }}>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <label className="field">
        Name
        <input name="name" required defaultValue={customer?.name} placeholder="e.g. Englewood Dentistry" />
      </label>
      <div className="row2">
        <label className="field">
          Email
          <input name="email" type="email" defaultValue={customer?.email ?? ""} />
        </label>
        <label className="field">
          Phone
          <input name="phone" type="tel" defaultValue={customer?.phone ?? ""} />
        </label>
      </div>
      <label className="field">
        Billing address
        <input name="address" defaultValue={customer?.address ?? ""} />
      </label>
      <label className="field">
        Notes
        <textarea name="notes" rows={2} defaultValue={customer?.notes ?? ""} />
      </label>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      {state.ok && <p className="ok" role="status">{state.ok}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : customer ? "Save customer" : "Add customer"}</button>
      </div>
    </form>
  );
}
