import { linkedQuantity, measurementValue, type Measurement, type SheetScale } from "./takeoff";

// Estimate math shared by the editor, the lists and the client's copy.
export type EstItem = {
  id: string; group_id: string; catalog_item_id: string | null; name: string; description: string; cost_type_id: number | null; unit_id: number | null;
  quantity: number; unit_cost: number; unit_price: number; measurement_id: string | null; qty_factor: number; waste_pct: number; position: number;
};
export type EstGroup = { id: string; name: string; description: string; client_view: "items" | "qty" | "total"; display_qty: number | null; display_unit: string | null; position: number; budget_group_id?: string | null };
export type EstStep = { id: string; name: string; percent: number; position: number };

export const CLIENT_VIEWS = { items: "Items with prices", qty: "Items, no prices", total: "Group total only" } as const;
// What the client's copy shows, set per document. Unit costs never show.
export const CLIENT_SHOW = {
  items: "Line items",
  descriptions: "Item descriptions",
  qty: "Quantities and units",
  unit_price: "Unit prices",
  line_total: "Line totals",
  group_total: "Group totals",
} as const;
export type ClientShow = Record<keyof typeof CLIENT_SHOW, boolean>;
export const clientShow = (v: unknown): ClientShow => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(CLIENT_SHOW).map((k) => [k, o[k] !== false])) as ClientShow;
};
// A document's client price: its lines added up, a price per unit, or a lump sum.
export type DocPrice = { price_mode: "items" | "unit" | "lump"; price_qty: number | null; price_unit: string; price_rate: number | null; price_lump: number | null };
export const DOC_PRICE_FIELDS = "price_mode, price_qty, price_unit, price_rate, price_lump";
export const ITEMIZED: DocPrice = { price_mode: "items", price_qty: null, price_unit: "SF", price_rate: null, price_lump: null };
export function docPrice(p: DocPrice | null | undefined, itemsPrice: number) {
  if (p?.price_mode === "unit") return Math.round(Number(p.price_qty ?? 0) * Number(p.price_rate ?? 0) * 100) / 100;
  if (p?.price_mode === "lump") return Number(p.price_lump ?? 0);
  return itemsPrice;
}
// "2,436 SF × $11.49/SF", shown with the total when priced per unit.
export function priceLine(p: DocPrice | null | undefined) {
  if (p?.price_mode !== "unit") return null;
  const q = Number(p.price_qty ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const r = Number(p.price_rate ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `${q} ${p.price_unit} × ${r}/${p.price_unit}`;
}
// Read separately so pages still work on a database without these columns.
export async function loadDocPrices(supabase: { from: (t: string) => any }, ids: string[]): Promise<Map<string, DocPrice>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("estimates").select(`id, ${DOC_PRICE_FIELDS}`).in("id", ids);
  if (error || !data) return new Map();
  return new Map((data as (DocPrice & { id: string })[]).map((r) => [r.id, r]));
}
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
