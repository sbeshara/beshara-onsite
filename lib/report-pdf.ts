import "server-only";
import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  clip,
  endPath,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

// A port of the firm's progress_report.py layout: cover page, COMPLETED page
// with two site photos, Looking Ahead page (or both sections on one page).

export type ReportLine = { trade: string; text: string };
export type ReportPdfInput = {
  name: string;
  week: string; // "10/12/26"
  nextWeek: string; // "10/19/26"
  completed: string[];
  ahead: string[];
  photos: { bytes: Uint8Array; type: string }[]; // up to two
  combined?: boolean;
  skipCompleted?: boolean;
};

export const PENDING = "Pending — project manager to confirm";
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const DARK = hex("#445C4F");
const LIGHT = hex("#8FA898");
const GRAY = hex("#9E9E9E");
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const W = 612;
const H = 792;
const PH_M = 54;

const ASSETS = path.join(process.cwd(), "assets", "report");
const asset = (f: string) => fs.readFileSync(path.join(ASSETS, f));

export const lineText = (l: ReportLine) => (l.trade.trim() ? `${l.trade.trim()}: ${l.text.trim()}` : l.text.trim());

// File name the office uses, e.g. "DRAFT - Salib Smiles - Progress Report 10-12.pdf".
export function reportFileName(name: string, week: string, draft: boolean) {
  const [m, d] = week.split("/");
  return `${draft ? "DRAFT - " : ""}${name.replace(/[\\/:*?"<>|]/g, "")} - Progress Report ${m}-${d}.pdf`;
}

type Fonts = { regular: PDFFont; bold: PDFFont; light: PDFFont; italic: PDFFont };

function wrapText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = `${cur} ${w}`.trim();
    if (font.widthOfTextAtSize(t, size) <= width) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function centered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = BLACK, spacing = 0) {
  if (!spacing) {
    page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
    return;
  }
  const width = font.widthOfTextAtSize(text, size) + spacing * (text.length - 1);
  let x = (W - width) / 2;
  for (const ch of text) {
    page.drawText(ch, { x, y, size, font, color });
    x += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

function blockHeight(items: string[], size: number, textW: number, f: Fonts) {
  const lead = size * 1.45;
  let total = 0;
  for (const it of items) total += wrapText(it, f.regular, size, textW).length * lead + size * 0.75;
  return total - size * 0.75 + 48;
}

// Sage block with white bullets; returns the y of its bottom edge.
function drawBlock(page: PDFPage, items: string[], size: number, topY: number, f: Fonts) {
  const textW = W - 2 * PH_M - 52;
  const h = blockHeight(items, size, textW, f);
  page.drawRectangle({ x: PH_M, y: topY - h, width: W - 2 * PH_M, height: h, color: DARK });
  const lead = size * 1.45;
  let y = topY - 24 - size;
  for (const it of items) {
    const font = it === PENDING ? f.italic : f.regular;
    page.drawCircle({ x: PH_M + 24, y: y + size * 0.32, size: 2.6, color: WHITE });
    for (const ln of wrapText(it, font, size, textW)) {
      page.drawText(ln, { x: PH_M + 36, y, size, font, color: WHITE });
      y -= lead;
    }
    y -= size * 0.75;
  }
  return topY - h;
}

function footer(page: PDFPage, d: ReportPdfInput, f: Fonts) {
  centered(page, `Beshara Builders LLC  |  Healthcare Construction Management  |  ${d.name}  |  Week of ${d.week}`, f.light, 8, 36, GRAY);
}

function chevrons(page: PDFPage, cx: number, y: number) {
  for (let i = 0; i < 3; i++) {
    const x = cx - 30 + i * 22;
    const style = { thickness: 2.2, color: DARK, dashArray: [3, 2.5] };
    page.drawLine({ start: { x, y: y + 13 }, end: { x: x + 13, y }, ...style });
    page.drawLine({ start: { x: x + 13, y }, end: { x, y: y - 13 }, ...style });
  }
}

// Center-crops the photo to fill the box without distortion.
function drawPhoto(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const iw = img.width * scale;
  const ih = img.height * scale;
  page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
  page.pushOperators(popGraphicsState());
}

export async function buildReportPdf(d: ReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${d.name} — Progress Report — Week of ${d.week}`);
  pdf.setAuthor("Beshara Builders LLC");
  const f: Fonts = {
    regular: await pdf.embedFont(asset("Poppins-Regular.ttf"), { subset: true }),
    bold: await pdf.embedFont(asset("Poppins-Bold.ttf"), { subset: true }),
    light: await pdf.embedFont(asset("Poppins-Light.ttf"), { subset: true }),
    italic: await pdf.embedFont(asset("Poppins-Italic.ttf"), { subset: true }),
  };
  const logo = await pdf.embedJpg(asset("logo-dark.jpg"));
  const completed = d.completed.length ? d.completed : [PENDING];
  const ahead = d.ahead.length ? d.ahead : [PENDING];

  // Cover.
  let page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: DARK, borderWidth: 2.5 });
  page.drawRectangle({ x: 37, y: 37, width: W - 74, height: H - 74, borderColor: DARK, borderWidth: 0.8 });
  const lw = 320;
  const lh = (lw * logo.height) / logo.width;
  const ly = H - 205 - lh;
  page.drawImage(logo, { x: (W - lw) / 2, y: ly, width: lw, height: lh });
  centered(page, "HEALTHCARE CONSTRUCTION MANAGEMENT", f.light, 8.5, ly - 22, LIGHT, 1.6);
  let y = ly - 130;
  centered(page, "PROGRESS REPORT", f.bold, 40, y, DARK);
  y -= 28;
  page.drawLine({ start: { x: 110, y }, end: { x: W - 110, y }, thickness: 2, color: BLACK });
  y -= 52;
  for (const ln of wrapText(d.name, f.bold, 30, W - 150)) {
    centered(page, ln, f.bold, 30, y, BLACK);
    y -= 38;
  }
  y -= 8;
  centered(page, `WEEK OF ${d.week}`, f.bold, 24, y, DARK);

  if (d.combined) {
    // Completed + Looking Ahead on one page, no photo spots.
    page = pdf.addPage([W, H]);
    centered(page, "COMPLETED", f.bold, 44, H - 100, LIGHT);
    let yy = drawBlock(page, completed, 12.5, H - 130, f);
    yy -= 70;
    centered(page, "Looking Ahead", f.bold, 40, yy, LIGHT);
    centered(page, `Week of ${d.nextWeek}`, f.regular, 20, yy - 32, GRAY);
    chevrons(page, W / 2 - 6, yy - 80);
    drawBlock(page, ahead, 13.5, yy - 120, f);
    footer(page, d, f);
  } else {
    if (!d.skipCompleted) {
      page = pdf.addPage([W, H]);
      centered(page, "COMPLETED", f.bold, 44, H - 100, LIGHT);
      const top = H - 135;
      const gap = 14;
      const pw = (W - 2 * PH_M - gap) / 2;
      const ph = 195;
      for (let i = 0; i < 2; i++) {
        const x = PH_M + i * (pw + gap);
        const photo = d.photos[i];
        let img: PDFImage | null = null;
        if (photo) {
          try {
            img = /png/i.test(photo.type) ? await pdf.embedPng(photo.bytes) : await pdf.embedJpg(photo.bytes);
          } catch {
            img = null; // e.g. HEIC; fall back to the placeholder
          }
        }
        if (img) drawPhoto(page, img, x, top - ph, pw, ph);
        else {
          page.drawRectangle({ x, y: top - ph, width: pw, height: ph, color: hex("#E3E3E3") });
          const label = `Site Photo ${i + 1}`;
          page.drawText(label, { x: x + pw / 2 - f.regular.widthOfTextAtSize(label, 9) / 2, y: top - ph / 2, size: 9, font: f.regular, color: GRAY });
        }
      }
      drawBlock(page, completed, 12.5, top - ph - 22, f);
    }
    page = pdf.addPage([W, H]);
    centered(page, "Looking Ahead", f.bold, 40, H - 100, LIGHT);
    centered(page, `Week of ${d.nextWeek}`, f.regular, 20, H - 132, GRAY);
    chevrons(page, W / 2 - 6, H - 180);
    drawBlock(page, ahead, 13.5, H - 220, f);
    footer(page, d, f);
  }
  return pdf.save();
}
