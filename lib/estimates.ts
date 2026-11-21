import { linkedQuantity, measurementValue, type Measurement, type SheetScale } from "./takeoff";

// Estimate math shared by the editor, the lists and the client's copy.
export type EstItem = {
  id: string; group_id: string; catalog_item_id: string | null; name: string; description: string; cost_type_id: number | null; unit_id: number | null;
  quantity: number; unit_cost: number; unit_price: number; measurement_id: string | null; qty_factor: number; waste_pct: number; position: number;
};
export type EstGroup = { id: string; name: string; description: string; client_view: "items" | "qty" | "total"; display_qty: number | null; display_unit: string | null; position: number };
export type EstStep = { id: string; name: string; percent: number; position: number };

export const CLIENT_VIEWS = { items: "Items with prices", qty: "Items, no prices", total: "Group total only" } as const;
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", pending: "Awaiting signature", approved: "Signed", denied: "Declined" };

// An item's quantity: from its takeoff when linked, otherwise what was typed.
export function itemQty(it: Pick<EstItem, "quantity" | "measurement_id" | "qty_factor" | "waste_pct">, measures: Map<string, { m: Measurement; sheet: SheetScale | undefined }>) {
  if (!it.measurement_id) return Number(it.quantity) || 0;
  const hit = measures.get(it.measurement_id);
  if (!hit) return Number(it.quantity) || 0;
  return linkedQuantity(measurementValue(hit.m, hit.sheet), Number(it.qty_factor), Number(it.waste_pct));
}

export function totals(items: { q: number; c: number; p: number }[]) {
  const cost = items.reduce((s, i) => s + i.q * i.c, 0);
  const price = items.reduce((s, i) => s + i.q * i.p, 0);
  return { cost, price, profit: price - cost, margin: price ? ((price - cost) / price) * 100 : 0 };
}

export const docNumber = (jobNumber: string | null | undefined, seq: number) => (jobNumber ? `${jobNumber}-${seq}` : `#${seq}`);
