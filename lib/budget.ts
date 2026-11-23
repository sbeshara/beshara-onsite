import type { SupabaseClient } from "@supabase/supabase-js";

// The job budget: every cost group and item for a job. Documents are made by
// ticking budget lines, and each document line remembers its budget line.

export type BudgetGroup = { id: string; name: string; description: string; position: number };
export type BudgetItem = {
  id: string; group_id: string; catalog_item_id: string | null; name: string; description: string;
  cost_type_id: number | null; unit_id: number | null; quantity: number; unit_cost: number; unit_price: number;
  measurement_id: string | null; qty_factor: number; waste_pct: number; position: number;
};
export const BUDGET_ITEM_FIELDS = "id, group_id, catalog_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position";

// Which documents a budget line is on, e.g. Proposal 2710-4 (Signed).
export type DocRef = { estimate_id: string; seq: number; kind: string; name: string; status: string };

const ITEM_COPY = ["name", "description", "cost_type_id", "unit_id", "quantity", "unit_cost", "unit_price", "measurement_id", "qty_factor", "waste_pct"] as const;
const check = <T>(r: { data: T; error: { message: string } | null }, what: string) => {
  if (r.error) throw new Error(`Couldn't save the ${what}: ${r.error.message}`);
  return r.data;
};
const key = (s: string) => s.trim().toLowerCase();

// Fill a job's budget from its documents (signed, pending and drafts; declined
// ones are left out), and link each document line to its budget line. Lines
// already linked are skipped, so it can run again. The same item on two
// documents (a revised proposal, say) becomes one budget line.
export async function budgetFromDocuments(db: SupabaseClient, projectId: string) {
  const { data: ests } = await db.from("estimates").select("id, seq, status").eq("project_id", projectId).neq("status", "denied").order("seq");
  if (!ests?.length) return { groups: 0, items: 0, linked: 0 };
  // Signed documents first: they're what the job is built from.
  const order = [...ests].sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved") || a.seq - b.seq);
  const ids = order.map((e) => e.id);
  const [{ data: eg }, { data: ei }, { data: bg }, { data: bi }] = await Promise.all([
    db.from("estimate_groups").select("id, estimate_id, name, description, position, budget_group_id").in("estimate_id", ids),
    db.from("estimate_items").select("id, estimate_id, group_id, catalog_item_id, position, budget_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct").in("estimate_id", ids),
    db.from("budget_groups").select("id, name, position").eq("project_id", projectId),
    db.from("budget_items").select("id, group_id, name, unit_price, quantity").eq("project_id", projectId),
  ]);
  const groups = [...(bg ?? [])];
  const items = [...(bi ?? [])];
  const made = { groups: 0, items: 0, linked: 0 };
  for (const est of order) {
    for (const g of (eg ?? []).filter((x) => x.estimate_id === est.id).sort((a, b) => a.position - b.position)) {
      let bgId = g.budget_group_id as string | null;
      if (!bgId) {
        let hit = groups.find((x) => key(x.name) === key(g.name));
        if (!hit) {
          hit = check(await db.from("budget_groups").insert({ project_id: projectId, name: g.name, description: g.description, position: groups.length }).select("id, name, position").single(), "budget group")!;
          groups.push(hit);
          made.groups++;
        }
        bgId = hit!.id;
        check(await db.from("estimate_groups").update({ budget_group_id: bgId }).eq("id", g.id), "group link");
      }
      for (const it of (ei ?? []).filter((x) => x.group_id === g.id && !x.budget_item_id).sort((a, b) => a.position - b.position)) {
        let hit = items.find((x) => x.group_id === bgId && key(x.name) === key(it.name) && Number(x.unit_price) === Number(it.unit_price) && Number(x.quantity) === Number(it.quantity));
        if (!hit) {
          const row: Record<string, unknown> = { project_id: projectId, group_id: bgId, catalog_item_id: it.catalog_item_id, position: items.filter((x) => x.group_id === bgId).length };
          for (const f of ITEM_COPY) row[f] = (it as Record<string, unknown>)[f];
          hit = check(await db.from("budget_items").insert(row).select("id, group_id, name, unit_price, quantity").single(), "budget item")!;
          items.push(hit);
          made.items++;
        }
        check(await db.from("estimate_items").update({ budget_item_id: hit!.id }).eq("id", it.id), "item link");
        made.linked++;
      }
    }
  }
  return made;
}

// Copy a catalog group into the budget: its sub-groups become budget groups,
// each with its catalog items (quantity from the catalog, else 0).
export async function budgetFromCatalog(db: SupabaseClient, projectId: string, catalogGroupId: string) {
  const [{ data: cg }, { data: ci }, { count }] = await Promise.all([
    db.from("cost_groups").select("id, parent_id, name, description, position").eq("archived", false),
    db.from("cost_items").select("id, cost_group_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, position").eq("archived", false),
    db.from("budget_groups").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  const root = (cg ?? []).find((g) => g.id === catalogGroupId);
  if (!root) throw new Error("That catalog group is gone. Reload and try again.");
  const kids = (cg ?? []).filter((g) => g.parent_id === root.id).sort((a, b) => a.position - b.position);
  let pos = count ?? 0, n = 0;
  for (const g of kids.length ? kids : [root]) {
    const bg = check(await db.from("budget_groups").insert({ project_id: projectId, name: g.name, description: g.description, position: pos++ }).select("id").single(), "budget group");
    const its = (ci ?? []).filter((x) => x.cost_group_id === g.id).sort((a, b) => a.position - b.position);
    if (its.length)
      check(await db.from("budget_items").insert(its.map((x, i) => ({
        project_id: projectId, group_id: bg!.id, catalog_item_id: x.id, name: x.name, description: x.description,
        cost_type_id: x.cost_type_id, unit_id: x.unit_id, quantity: x.quantity ?? 0, unit_cost: x.unit_cost ?? 0, unit_price: x.unit_price ?? 0, position: i,
      }))), "budget items");
    n += its.length;
  }
  return n;
}
