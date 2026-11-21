// The client's copy of a proposal: exactly what they see and sign, frozen
// when it's sent. No costs or margins, and prices only where each group's
// setting shows them.
export type ClientCopy = {
  number: string;
  kind: string;
  name: string;
  issued_on: string;
  prepared_for: string[];
  project: string[];
  intro: string;
  terms: string;
  groups: {
    name: string;
    description: string;
    view: "items" | "qty" | "total";
    total: number;
    display: string | null; // e.g. "2,280 SF × $4.38/SF" or "Lump sum" (group-total view)
    items: { name: string; description: string; qty: string; unit_price?: number; unit?: string; total?: number }[];
  }[];
  total: number;
  steps: { name: string; percent: number; amount: number }[];
};
