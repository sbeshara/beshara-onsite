import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Measurement, SheetScale } from "@/lib/takeoff";

// A job's takeoff measurements with their sheets' scales, for linked quantities.
export async function jobMeasures(supabase: SupabaseClient, projectId: string) {
  const [{ data: ms }, { data: sheets }] = await Promise.all([
    supabase.from("takeoff_measurements").select("id, sheet_id, name, kind, color, points, hidden").eq("project_id", projectId).order("created_at"),
    supabase.from("plan_sheets").select("id, name, scale_in_per_ft, points_per_foot").eq("project_id", projectId),
  ]);
  const bySheet = new Map((sheets ?? []).map((s) => [s.id as string, s as SheetScale & { id: string; name: string }]));
  const list = ((ms ?? []) as Measurement[]).map((m) => ({ m, sheet: bySheet.get(m.sheet_id) }));
  return { list, map: new Map(list.map((x) => [x.m.id, x])) };
}

// Builds the client's copy of an estimate from its current contents.
export async function buildClientCopy(supabase: SupabaseClient, projectId: string, estimateId: string): Promise<import("@/lib/client-copy").ClientCopy | null> {
  const { docNumber, itemQty } = await import("@/lib/estimates");
  const { fmtQty } = await import("@/lib/takeoff");
  const [{ data: est }, { data: groups }, { data: items }, { data: steps }, { data: job }, { data: units }, measures] = await Promise.all([
    supabase.from("estimates").select("seq, kind, name, intro, terms, issued_on").eq("id", estimateId).eq("project_id", projectId).maybeSingle(),
    supabase.from("estimate_groups").select("id, name, description, client_view, display_qty, display_unit").eq("estimate_id", estimateId).order("position"),
    supabase.from("estimate_items").select("group_id, name, description, unit_id, quantity, unit_price, measurement_id, qty_factor, waste_pct").eq("estimate_id", estimateId).order("position"),
    supabase.from("estimate_payment_steps").select("name, percent").eq("estimate_id", estimateId).order("position"),
    supabase.from("projects").select("job_number, name, town, address, customers(name, customer_contacts(name, is_primary))").eq("id", projectId).maybeSingle(),
    supabase.from("units").select("id, abbr"),
    jobMeasures(supabase, projectId),
  ]);
  if (!est || !job) return null;
  const abbr = (id: number | null) => units?.find((u) => u.id === id)?.abbr ?? "";
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  type Row = { group_id: string; name: string; description: string; unit_id: number | null; quantity: number; unit_price: number; measurement_id: string | null; qty_factor: number; waste_pct: number };
  const rows = ((items ?? []) as Row[]).map((r) => ({ ...r, q: itemQty(r, measures.map), p: Number(r.unit_price) }));
  const out = (groups ?? []).map((g) => {
    const gi = rows.filter((r) => r.group_id === g.id);
    const total = Math.round(gi.reduce((s, r) => s + r.q * r.p, 0) * 100) / 100;
    const view = g.client_view as "items" | "qty" | "total";
    return {
      name: g.name,
      description: g.description,
      view,
      total,
      display: view === "total" ? (g.display_unit && g.display_qty ? `${fmtQty(Number(g.display_qty))} ${g.display_unit} × ${money(total / Number(g.display_qty))}/${g.display_unit}` : "Lump sum") : null,
      items:
        view === "total"
          ? []
          : gi.map((r) => {
              const u = abbr(r.unit_id);
              const qty = u === "LS" ? "Lump sum" : `${fmtQty(r.q)} ${u}`.trim();
              return view === "items" ? { name: r.name, description: r.description, qty, unit: u, unit_price: r.p, total: Math.round(r.q * r.p * 100) / 100 } : { name: r.name, description: r.description, qty };
            }),
    };
  });
  const total = Math.round(out.reduce((s, g) => s + g.total, 0) * 100) / 100;
  const customer = job.customers as unknown as { name: string; customer_contacts: { name: string; is_primary: boolean }[] } | null;
  const contact = customer?.customer_contacts.find((c) => c.is_primary) ?? customer?.customer_contacts[0];
  return {
    number: docNumber(job.job_number, est.seq),
    kind: est.kind,
    name: est.name,
    issued_on: est.issued_on,
    prepared_for: [...new Set([contact?.name, customer?.name].filter((x): x is string => !!x))],
    project: [job.name, job.address || job.town].filter(Boolean) as string[],
    intro: est.intro,
    terms: est.terms,
    groups: out,
    total,
    steps: (steps ?? []).map((s) => ({ name: s.name, percent: Number(s.percent), amount: Math.round(total * Number(s.percent)) / 100 })),
  };
}
