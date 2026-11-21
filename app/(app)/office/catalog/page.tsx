import { createClient } from "@/lib/supabase/server";
import CatalogEditor, { type Group, type Item } from "./CatalogEditor";

export const metadata = { title: "Catalog · Beshara OnSite" };

export default async function CatalogPage() {
  const supabase = await createClient();
  const [{ data: groups }, { data: items }, { data: types }, { data: units }] = await Promise.all([
    supabase.from("cost_groups").select("id, parent_id, name, description, position").eq("archived", false).order("position").order("name"),
    supabase.from("cost_items").select("id, cost_group_id, name, description, cost_type_id, unit_id, unit_cost, unit_price").eq("archived", false).order("position").order("name"),
    supabase.from("cost_types").select("id, name").order("position"),
    supabase.from("units").select("id, name, abbr").order("id"),
  ]);
  return (
    <div className="page">
      <div className="page-h">
        <h1>Catalog</h1>
        <p>Your cost groups and cost items. A group&apos;s description is what clients read on proposals; item prices fill in new estimates. Groups inside a group (like an Interior Fit-Out with its trades) work as templates.</p>
      </div>
      <CatalogEditor groups={(groups ?? []) as Group[]} items={(items ?? []) as Item[]} types={types ?? []} units={units ?? []} />
    </div>
  );
}
