import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientCopy } from "./client-copy";

// Signed estimates' payment steps with their invoices, for one job or all.
export type StepRow = {
  id: string; name: string; percent: number; reached_at: string | null; amount: number;
  estimate: { id: string; seq: number; kind: string; name: string; project_id: string; total: number };
  invoice: InvoiceRow | null;
};
export type InvoiceRow = {
  id: string; project_id: string; seq: number; description: string; amount: number; status: string; issued_on: string; due_on: string | null;
  sent_at: string | null; paid_total: number; qbo_invoice_id: string | null; qbo_error: string | null; step_id: string | null;
  invoice_payments: { amount: number; paid_on: string; method: string | null }[];
};

export async function billing(supabase: SupabaseClient, projectId?: string) {
  let eq = supabase.from("estimates").select("id, seq, kind, name, project_id, client_copy, estimate_payment_steps(id, name, percent, position, reached_at)").eq("status", "approved");
  let iq = supabase.from("invoices").select("id, project_id, seq, description, amount, status, issued_on, due_on, sent_at, paid_total, qbo_invoice_id, qbo_error, step_id, invoice_payments(amount, paid_on, method)").order("seq", { ascending: false });
  if (projectId) { eq = eq.eq("project_id", projectId); iq = iq.eq("project_id", projectId); }
  const [{ data: ests }, { data: invs }] = await Promise.all([eq, iq]);
  const invoices = (invs ?? []) as InvoiceRow[];
  const steps: StepRow[] = [];
  for (const e of ests ?? []) {
    const total = (e.client_copy as ClientCopy | null)?.total ?? 0;
    for (const s of [...(e.estimate_payment_steps ?? [])].sort((a, b) => a.position - b.position)) {
      steps.push({
        id: s.id, name: s.name, percent: Number(s.percent), reached_at: s.reached_at,
        amount: Math.round(total * Number(s.percent)) / 100,
        estimate: { id: e.id, seq: e.seq, kind: e.kind, name: e.name, project_id: e.project_id, total },
        invoice: invoices.find((i) => i.step_id === s.id && i.status !== "void") ?? null,
      });
    }
  }
  return { steps, invoices };
}

export const INVOICE_LABEL: Record<string, string> = { draft: "Draft", sent: "Sent", partial: "Partly paid", paid: "Paid", void: "Void" };
