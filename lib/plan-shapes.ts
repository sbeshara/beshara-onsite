import type { Pt } from "./takeoff";

// Markup shapes, shared by the on-screen canvas and the PDF export so both
// draw exactly the same thing. Coordinates are PDF points, top-left origin.

export type MarkupKind = "pen" | "line" | "arrow" | "rect" | "cloud" | "text";
export type Markup = { id: string; sheet_id: string; kind: MarkupKind; color: string; data: { points?: Pt[]; x?: number; y?: number; text?: string; size?: number } };

export const MARKUP_COLORS = ["#C2416D", "#C0643A", "#2D7FB8", "#3F8A5A", "#111111"];

// A revision cloud around a rectangle: bumps along each side, as a polyline.
export function cloudPoints(a: Pt, b: Pt, bump = 14): Pt[] {
  const x1 = Math.min(a[0], b[0]), y1 = Math.min(a[1], b[1]), x2 = Math.max(a[0], b[0]), y2 = Math.max(a[1], b[1]);
  const sides: [Pt, Pt][] = [[[x1, y1], [x2, y1]], [[x2, y1], [x2, y2]], [[x2, y2], [x1, y2]], [[x1, y2], [x1, y1]]];
  const out: Pt[] = [];
  for (const [p, q] of sides) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.round(len / (bump * 2)));
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    // Outward normal for a clockwise rectangle (y down) is (uy, -ux).
    const nx = uy, ny = -ux;
    for (let i = 0; i < n; i++) {
      const s = (i / n) * len, e = ((i + 1) / n) * len, r = (e - s) / 2;
      const cx = p[0] + ux * (s + r), cy = p[1] + uy * (s + r);
      for (let k = 0; k <= 8; k++) {
        const t = Math.PI - (k / 8) * Math.PI; // half circle from start to end of the bump
        out.push([cx + ux * Math.cos(t) * r + nx * Math.sin(t) * r * 0.9, cy + uy * Math.cos(t) * r + ny * Math.sin(t) * r * 0.9]);
      }
    }
  }
  return out;
}

export function rectPoints(a: Pt, b: Pt): Pt[] {
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
}

// Arrowhead at the end of a line: the two barb points.
export function arrowHead(from: Pt, to: Pt, size = 14): [Pt, Pt] {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return [
    [to[0] - size * Math.cos(ang - 0.45), to[1] - size * Math.sin(ang - 0.45)],
    [to[0] - size * Math.cos(ang + 0.45), to[1] - size * Math.sin(ang + 0.45)],
  ];
}

// The polylines a markup is made of (text has none).
export function markupPaths(m: Pick<Markup, "kind" | "data">): Pt[][] {
  const p = m.data.points ?? [];
  if (m.kind === "pen") return [p];
  if (p.length < 2) return [];
  const [a, b] = [p[0], p[p.length - 1]];
  if (m.kind === "line") return [[a, b]];
  if (m.kind === "arrow") {
    const [l, r] = arrowHead(a, b);
    return [[a, b], [l, b, r]];
  }
  if (m.kind === "rect") return [rectPoints(a, b)];
  if (m.kind === "cloud") return [[...cloudPoints(a, b), cloudPoints(a, b)[0]]];
  return [];
}

export const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};
