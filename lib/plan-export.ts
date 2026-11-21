import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { hexToRgb, markupPaths, type Markup } from "./plan-shapes";
import { KIND_UNIT, labelPoint, measurementValue, fmtQty, type Measurement, type SheetScale } from "./takeoff";

// Builds a new PDF from the original plan pages with markup (and, if asked,
// takeoff measurements) drawn on top as vector lines, so the drawings stay
// sharp. Runs in the browser.
export type ExportPage = { pageNumber: number; sheet: SheetScale; markups: Markup[]; measurements: Measurement[] };

export async function exportPlanPdf(original: ArrayBuffer, viewer: PDFDocumentProxy, pages: ExportPage[], withMeasurements: boolean) {
  const src = await PDFDocument.load(original, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const copied = await out.copyPages(src, pages.map((p) => p.pageNumber - 1));

  for (const [i, spec] of pages.entries()) {
    const page = out.addPage(copied[i]);
    const vp = (await viewer.getPage(spec.pageNumber)).getViewport({ scale: 1 });
    const rot = page.getRotation().angle % 360;
    // Our points are in the sheet as displayed (top-left origin); convert to PDF space.
    const P = (x: number, y: number) => vp.convertToPdfPoint(x, y) as [number, number];
    const path = (pts: [number, number][], close = false) =>
      pts.map(([x, y], k) => { const [px, py] = P(x, y); return `${k ? "L" : "M"}${px.toFixed(2)},${(-py).toFixed(2)}`; }).join(" ") + (close ? " Z" : "");
    const color = (hex: string) => rgb(...hexToRgb(hex));
    const label = (text: string, x: number, y: number, hex: string) => {
      const size = 8, w = bold.widthOfTextAtSize(text, size) + 6;
      const [px, py] = P(x, y);
      // A filled tag behind the text, kept upright on rotated sheets.
      page.drawRectangle({ x: px - w / 2, y: py - 6, width: w, height: 12, color: color(hex), rotate: degrees(rot) });
      page.drawText(text, { x: px - w / 2 + 3, y: py - 3, size, font: bold, color: rgb(1, 1, 1), rotate: degrees(rot) });
    };

    for (const m of spec.markups) {
      if (m.kind === "text") {
        const [px, py] = P(m.data.x ?? 0, m.data.y ?? 0);
        page.drawText(m.data.text ?? "", { x: px, y: py, size: m.data.size ?? 14, font: regular, color: color(m.color), rotate: degrees(rot) });
        continue;
      }
      for (const pts of markupPaths(m)) {
        if (pts.length < 2) continue;
        page.drawSvgPath(path(pts), { x: 0, y: 0, borderColor: color(m.color), borderWidth: 2 });
      }
    }

    if (!withMeasurements) continue;
    for (const m of spec.measurements.filter((x) => !x.hidden)) {
      const v = measurementValue(m, spec.sheet);
      const text = v == null ? m.name : `${m.name}: ${fmtQty(v, KIND_UNIT[m.kind])}`;
      if (m.kind === "count") {
        m.points.forEach(([x, y]) => {
          const [px, py] = P(x, y);
          page.drawCircle({ x: px, y: py, size: 4, color: color(m.color) });
        });
        if (m.points[0]) label(text, m.points[0][0], m.points[0][1] - 12, m.color);
        continue;
      }
      if (m.points.length < 2) continue;
      const area = m.kind === "area";
      page.drawSvgPath(path(m.points, area), {
        x: 0, y: 0, borderColor: color(m.color), borderWidth: 2,
        ...(area ? { color: color(m.color), opacity: 0.18, borderOpacity: 1 } : {}),
      });
      const c = labelPoint(m);
      if (c) label(text, c[0], c[1], m.color);
    }
  }
  return out.save();
}
