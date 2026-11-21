// Takeoff math shared by the Plans screen and the estimate builder.
// Points are PDF points (1/72"), measured from a sheet's top-left corner.

export type Pt = [number, number];
export type MeasureKind = "linear" | "area" | "count";
export type SheetScale = { scale_in_per_ft: number | null; points_per_foot: number | null };
export type Measurement = { id: string; sheet_id: string; name: string; kind: MeasureKind; color: string; points: Pt[]; hidden: boolean };

export const KIND_UNIT: Record<MeasureKind, string> = { linear: "LF", area: "SF", count: "EA" };
export const TAKEOFF_COLORS = ["#C0643A", "#2D7FB8", "#3F8A5A", "#9A5BB5", "#B8932D", "#C2416D", "#2A9C9C"];

// Preset scales: paper inches per real foot.
export const SCALE_PRESETS: { value: number; label: string }[] = [
  { value: 1 / 32, label: '1/32" = 1\'-0"' },
  { value: 1 / 16, label: '1/16" = 1\'-0"' },
  { value: 3 / 32, label: '3/32" = 1\'-0"' },
  { value: 1 / 8, label: '1/8" = 1\'-0"' },
  { value: 3 / 16, label: '3/16" = 1\'-0"' },
  { value: 1 / 4, label: '1/4" = 1\'-0"' },
  { value: 3 / 8, label: '3/8" = 1\'-0"' },
  { value: 1 / 2, label: '1/2" = 1\'-0"' },
  { value: 3 / 4, label: '3/4" = 1\'-0"' },
  { value: 1, label: '1" = 1\'-0"' },
  { value: 1.5, label: '1-1/2" = 1\'-0"' },
  { value: 3, label: '3" = 1\'-0"' },
];
export const scaleLabel = (s: SheetScale) =>
  s.points_per_foot ? "Calibrated" : s.scale_in_per_ft ? SCALE_PRESETS.find((p) => Math.abs(p.value - s.scale_in_per_ft!) < 1e-9)?.label ?? `${s.scale_in_per_ft}" = 1'-0"` : null;

// PDF points per real foot, or null when the sheet isn't scaled yet.
export const pointsPerFoot = (s: SheetScale | null | undefined) =>
  !s ? null : s.points_per_foot ? Number(s.points_per_foot) : s.scale_in_per_ft ? 72 * Number(s.scale_in_per_ft) : null;

export function pathLength(points: Pt[]) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return L;
}
export function polygonArea(points: Pt[]) {
  let A = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    A += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(A / 2);
}

// A measurement's value in LF, SF or EA; null if its sheet has no scale.
export function measurementValue(m: Pick<Measurement, "kind" | "points">, sheet: SheetScale | null | undefined): number | null {
  if (m.kind === "count") return m.points.length;
  const ppf = pointsPerFoot(sheet);
  if (!ppf) return null;
  return m.kind === "linear" ? pathLength(m.points) / ppf : polygonArea(m.points) / (ppf * ppf);
}

// An estimate line item's quantity when it's linked to a takeoff.
export const linkedQuantity = (value: number | null, factor: number, wastePct: number) => (value == null ? 0 : value * factor * (1 + wastePct / 100));

export const fmtQty = (n: number, unit?: string) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: unit === "EA" ? 0 : 1, minimumFractionDigits: unit === "EA" ? 0 : n < 100 && n % 1 ? 1 : 0 })}${unit ? ` ${unit}` : ""}`;

export const feetInches = (feet: number) => {
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  return inches === 12 ? `${whole + 1}'-0"` : `${whole}'-${inches}"`;
};

// Where a measurement's label goes: the middle of its middle segment, or the
// center of an area.
export function labelPoint(m: Pick<Measurement, "kind" | "points">): Pt | null {
  const p = m.points;
  if (!p.length) return null;
  if (m.kind === "area") return p.reduce<Pt>((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
  if (p.length === 1) return p[0];
  const i = Math.floor((p.length - 1) / 2);
  return [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
}
