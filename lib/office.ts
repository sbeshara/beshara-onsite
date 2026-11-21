// Small display helpers shared by the office pages.
const STATUS_CLASS: Record<string, string> = {
  "New Lead": "st-lead",
  Estimating: "st-lead",
  "On Hold": "st-hold",
  "Closed Lost": "st-lost",
  Approved: "st-approved",
  Preconstruction: "st-precon",
  Permitting: "st-permit",
  Construction: "st-build",
  Complete: "st-done",
};
export const statusClass = (s: string) => `status ${STATUS_CLASS[s] ?? ""}`;

export const usd = (n: number | null | undefined, cents = false) =>
  n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export const marginPct = (cost: number | null, price: number | null) => (price ? ((price - (cost ?? 0)) / price) * 100 : null);
