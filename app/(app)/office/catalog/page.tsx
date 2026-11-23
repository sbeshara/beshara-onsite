import { createClient } from "@/lib/supabase/server";
import CatalogEditor, { type Group, type Item } from "./CatalogEditor";

export const metadata = { title: "Catalog · Beshara OnSite" };

export default async function CatalogPage() {
  const supabase = await createClient();
  const [{ data: groups }, { data: items, error }, { data: types }, { data: units }] = await Promise.all([
    supabase.from("cost_groups").select("id, parent_id, name, description, position").eq("archived", false).order("position").order("name"),
    supabase.from("cost_items").select("id, cost_group_id, source_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, position").eq("archived", false).order("position").order("name"),
    supabase.from("cost_types").select("id, name").order("position"),
    supabase.from("units").select("id, name, abbr").order("id"),
  ]);
  if (error) return <div className="page"><p className="err">The catalog needs the latest database update. Run the newest SQL file, then reload.</p></div>;
  return (
    <div className="page">
      <div className="page-h">
        <h1>Catalog</h1>
        <p>Your cost groups and items, with prices, units and descriptions. Budgets are built from here.</p>
      </div>
      <CatalogEditor groups={(groups ?? []) as Group[]} items={(items ?? []) as Item[]} types={types ?? []} units={units ?? []} />
    </div>
  );
}
