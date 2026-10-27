import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { LOGO_PNG_BASE64 } from "./logo-data";

export type ReportLine = { trade: string; text: string; date?: string };
export type ReportPdfInput = {
  practice: string;
  address?: string | null;
  weekLabel: string; // "10/19/26 – 10/25/26"
  nextWeekLabel: string; // "10/26/26"
  completed: ReportLine[];
  lookingAhead: ReportLine[];
  photos: { bytes: Uint8Array; type: string; caption?: string }[];
};

const SAGE = rgb(69 / 255, 92 / 255, 81 / 255);
const BRASS = rgb(156 / 255, 119 / 255, 64 / 255);
const INK = rgb(21 / 255, 27 / 255, 24 / 255);
const MUTED = rgb(93 / 255, 106 / 255, 100 / 255);
const LINE = rgb(220 / 255, 227 / 255, 223 / 255);
const W = 612;
const H = 792;
const M = 54;

// The standard PDF fonts only cover Windows-1252; swap anything else for a safe stand-in.
function clean(s: string) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ•]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of clean(text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${clean(input.practice)} Beshara Builders Progress Report`);
  pdf.setAuthor("Beshara Builders");
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const footer = (p: PDFPage, n: number) => {
    p.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: LINE });
    p.drawText("Beshara Builders  ·  Healthcare construction management  ·  besharabuilders.com", { x: M, y: 30, size: 8, font: sans, color: MUTED });
    const label = `Page ${n}`;
    p.drawText(label, { x: W - M - sans.widthOfTextAtSize(label, 8), y: 30, size: 8, font: sans, color: MUTED });
  };

  const newPage = (first = false) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    const band = first ? 96 : 56;
    page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: SAGE });
    const lh = first ? 46 : 30;
    const lw = (logo.width / logo.height) * lh;
    page.drawImage(logo, { x: M, y: H - band + (band - lh) / 2, width: lw, height: lh });
    const title = "PROGRESS REPORT";
    const ts = first ? 13 : 10;
    page.drawText(title, { x: W - M - sansBold.widthOfTextAtSize(title, ts), y: H - band / 2 - ts / 3, size: ts, font: sansBold, color: rgb(1, 1, 1) });
    y = H - band - (first ? 40 : 30);
  };

  const ensure = (needed: number) => {
    if (y - needed < 64) newPage();
  };

  newPage(true);

  // Practice and week.
  for (const l of wrap(input.practice, serif, 28, W - 2 * M)) {
    page.drawText(l, { x: M, y, size: 28, font: serif, color: INK });
    y -= 32;
  }
  if (input.address) {
    page.drawText(clean(input.address), { x: M, y, size: 10, font: sans, color: MUTED });
    y -= 16;
  }
  page.drawText(`Week of ${clean(input.weekLabel)}`, { x: M, y, size: 13, font: serifItalic, color: SAGE });
  y -= 30;

  const section = (label: string, sub?: string) => {
    ensure(60);
    page.drawText(label, { x: M, y, size: 10, font: sansBold, color: BRASS });
    if (sub) page.drawText(clean(sub), { x: M + sansBold.widthOfTextAtSize(label, 10) + 10, y, size: 10, font: sans, color: MUTED });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: LINE });
    y -= 18;
  };

  const items = (lines: ReportLine[], empty: string) => {
    if (!lines.length) {
      page.drawText(empty, { x: M, y, size: 11, font: sans, color: MUTED });
      y -= 22;
      return;
    }
    for (const it of lines) {
      const lead = `${clean(it.trade)}: `;
      const leadW = sansBold.widthOfTextAtSize(lead, 11);
      const body = it.date ? `${it.text} (${it.date})` : it.text;
      const first = wrap(body, sans, 11, W - 2 * M - 14 - leadW);
      const firstLine = first[0] ?? "";
      const rest = wrap(body.slice(firstLine.length).trim(), sans, 11, W - 2 * M - 14);
      ensure(16 * (1 + rest.filter(Boolean).length) + 8);
      page.drawCircle({ x: M + 3, y: y + 4, size: 2, color: SAGE });
      page.drawText(lead, { x: M + 14, y, size: 11, font: sansBold, color: INK });
      page.drawText(firstLine, { x: M + 14 + leadW, y, size: 11, font: sans, color: INK });
      y -= 16;
      for (const l of rest.filter(Boolean)) {
        page.drawText(l, { x: M + 14, y, size: 11, font: sans, color: INK });
        y -= 16;
      }
      y -= 6;
    }
    y -= 10;
  };

  section("COMPLETED");
  items(input.completed, "No work to report this week.");
  section("LOOKING AHEAD", `Week of ${input.nextWeekLabel}`);
  items(input.lookingAhead, "Upcoming work will be shared in next week's report.");

  // Photos, two per row.
  const images: { img: PDFImage; caption?: string }[] = [];
  for (const p of input.photos) {
    try {
      const img = /png/i.test(p.type) ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
      images.push({ img, caption: p.caption });
    } catch {
      // Not a JPEG or PNG (e.g. HEIC); leave it out of the PDF.
    }
  }
  if (images.length) {
    section("SITE PHOTOS");
    const gap = 14;
    const cellW = (W - 2 * M - gap) / 2;
    const cellH = cellW * 0.75;
    for (let i = 0; i < images.length; i += 2) {
      ensure(cellH + 30);
      for (const [j, { img, caption }] of images.slice(i, i + 2).entries()) {
        const x = M + j * (cellW + gap);
        const scale = Math.min(cellW / img.width, cellH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawRectangle({ x, y: y - cellH, width: cellW, height: cellH, color: rgb(0.96, 0.97, 0.965) });
        page.drawImage(img, { x: x + (cellW - w) / 2, y: y - cellH + (cellH - h) / 2, width: w, height: h });
        if (caption) page.drawText(clean(caption).slice(0, 60), { x, y: y - cellH - 12, size: 8, font: sans, color: MUTED });
      }
      y -= cellH + 26;
    }
  }

  pages.forEach((p, i) => footer(p, i + 1));
  return pdf.save();
}
