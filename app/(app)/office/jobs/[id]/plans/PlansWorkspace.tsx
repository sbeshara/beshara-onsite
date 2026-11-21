"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";
import { FILES_BUCKET } from "@/lib/constants";
import { storagePath } from "@/lib/format";
import { MARKUP_COLORS, markupPaths, type Markup, type MarkupKind } from "@/lib/plan-shapes";
import {
  KIND_UNIT, SCALE_PRESETS, labelPoint, TAKEOFF_COLORS, feetInches, fmtQty, measurementValue, pointsPerFoot, scaleLabel,
  type MeasureKind, type Measurement, type Pt,
} from "@/lib/takeoff";

export type PlanFile = { id: string; name: string; storage_path: string; page_count: number; url: string };
export type Sheet = {
  id: string; plan_file_id: string; page_number: number; name: string; width_pt: number; height_pt: number;
  scale_in_per_ft: number | null; points_per_foot: number | null; position: number;
};
type Tool = "pan" | MeasureKind | "ruler" | "calibrate" | MarkupKind;
type Draft = { kind: MeasureKind; points: Pt[]; color: string } | null;
type Drag = { kind: MarkupKind; points: Pt[] } | null;

// pdf.js loads on demand, with its worker bundled by Next.
let pdfjsLoad: Promise<typeof import("pdfjs-dist")> | null = null;
const pdfjs = () =>
  (pdfjsLoad ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  }));

const HINTS: Record<Tool, string> = {
  pan: "Drag to move around, scroll or pinch to zoom.",
  linear: "Linear: click along the run. Double-click or Enter to finish. Shift keeps it straight; Backspace removes the last point.",
  area: "Area: click each corner. Click the first point or press Enter to close it.",
  count: "Count: click each item. Press Enter when you're done.",
  ruler: "Ruler: click two points to check a dimension. Nothing is saved.",
  calibrate: "Calibrate: click both ends of a dimension you know, then type its length.",
  pen: "Pen: drag to draw.",
  line: "Line: drag from start to end.",
  arrow: "Arrow: drag from the tail to the point.",
  rect: "Box: drag from corner to corner.",
  cloud: "Cloud: drag around the area to call out.",
  text: "Text: click where the note goes, type it, press Enter.",
};

export default function PlansWorkspace(props: {
  projectId: string; meId: string; jobLabel: string; files: PlanFile[]; sheets: Sheet[]; measurements: Measurement[];
  markups: Markup[]; chats: { id: string; name: string }[]; feeds: Record<string, string[]>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState(props.files);
  const [sheets, setSheets] = useState(props.sheets);
  const [measures, setMeasures] = useState(props.measurements);
  const [markups, setMarkups] = useState(props.markups);
  const [curId, setCurId] = useState<string | null>(props.sheets[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>("pan");
  const [markColor, setMarkColor] = useState(MARKUP_COLORS[0]);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"takeoff" | "markup">("takeoff");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [calib, setCalib] = useState<Pt[] | null>(null);
  const [textAt, setTextAt] = useState<Pt | null>(null);
  const [exporting, setExporting] = useState(false);

  const cur = sheets.find((s) => s.id === curId) ?? null;
  const curFile = cur ? files.find((f) => f.id === cur.plan_file_id) ?? null : null;

  // Loaded PDFs and rendered sheets, kept between renders.
  const docs = useRef(new Map<string, Promise<{ doc: PDFDocumentProxy; bytes: ArrayBuffer }>>());
  const renders = useRef(new Map<string, { canvas: HTMLCanvasElement; r: number }>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const view = useRef({ k: 1, x: 0, y: 0 });
  const mouse = useRef<Pt | null>(null);
  const draft = useRef<Draft>(null);
  const drag = useRef<Drag>(null);
  const ruler = useRef<Pt[] | null>(null);
  const shift = useRef(false);

  const loadDoc = useCallback(
    (file: PlanFile) => {
      let p = docs.current.get(file.id);
      if (!p) {
        p = (async () => {
          const res = await fetch(file.url);
          if (!res.ok) throw new Error("Couldn't download the plan file. Reload the page.");
          const bytes = await res.arrayBuffer();
          const lib = await pdfjs();
          const doc = await lib.getDocument({ data: bytes.slice(0) }).promise;
          return { doc, bytes };
        })();
        docs.current.set(file.id, p);
      }
      return p;
    },
    [],
  );

  // ---------- drawing ----------
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const d = window.devicePixelRatio || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!cur) return;
    const rendered = renders.current.get(cur.id);
    const { k, x, y } = view.current;
    const T = (p: Pt): Pt => [x + p[0] * k, y + p[1] * k];
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, cur.width_pt * k, cur.height_pt * k);
    if (rendered) ctx.drawImage(rendered.canvas, x, y, cur.width_pt * k, cur.height_pt * k);

    const tag = (text: string, p: Pt, color: string) => {
      ctx.font = '700 12px "Hanken Grotesk", Arial, sans-serif';
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(p[0] - w / 2, p[1] - 10, w, 20, 5);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, p[0], p[1] + 0.5);
    };
    const poly = (pts: Pt[], close = false) => {
      ctx.beginPath();
      pts.map(T).forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      if (close) ctx.closePath();
    };

    // markup
    for (const m of markups.filter((m) => m.sheet_id === cur.id)) {
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = Math.max(1.5, 2 * k);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (m.kind === "text") {
        const [tx, ty] = T([m.data.x ?? 0, m.data.y ?? 0]);
        ctx.font = `${(m.data.size ?? 14) * k}px "Hanken Grotesk", Arial, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(m.data.text ?? "", tx, ty);
        continue;
      }
      for (const pts of markupPaths(m)) {
        poly(pts);
        ctx.stroke();
      }
    }
    const dg = drag.current;
    if (dg) {
      ctx.strokeStyle = markColor;
      ctx.lineWidth = Math.max(1.5, 2 * k);
      for (const pts of markupPaths({ kind: dg.kind, data: { points: dg.points } })) {
        poly(pts);
        ctx.stroke();
      }
    }

    // takeoff
    for (const m of measures.filter((m) => m.sheet_id === cur.id && !m.hidden)) {
      const on = sel === m.id;
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = on ? 4 : 2.5;
      ctx.lineJoin = "round";
      if (m.kind === "count") {
        m.points.map(T).forEach(([px, py], i) => {
          ctx.fillStyle = m.color;
          ctx.beginPath();
          ctx.arc(px, py, on ? 9 : 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "700 9px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), px, py + 0.5);
        });
        if (m.points[0]) tag(`${m.points.length} EA`, [T(m.points[0])[0], T(m.points[0])[1] - 18], m.color);
        continue;
      }
      poly(m.points, m.kind === "area");
      if (m.kind === "area") {
        ctx.globalAlpha = on ? 0.3 : 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
      const v = measurementValue(m, cur);
      const c = labelPoint(m);
      if (c) tag(v == null ? "Set scale" : fmtQty(v, KIND_UNIT[m.kind]), T(c), m.color);
    }

    // in-progress takeoff
    const dr = draft.current, mp = mouse.current && snapPt(mouse.current);
    if (dr) {
      const pts = dr.kind === "count" ? dr.points : [...dr.points, ...(mp ? [mp] : [])];
      ctx.strokeStyle = dr.color;
      ctx.fillStyle = dr.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      if (dr.kind === "count") dr.points.map(T).forEach(([px, py]) => { ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); });
      else {
        poly(pts, dr.kind === "area" && pts.length > 2);
        if (dr.kind === "area" && pts.length > 2) { ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      dr.points.map(T).forEach(([px, py], i) => {
        ctx.beginPath();
        ctx.arc(px, py, i === 0 && dr.kind === "area" ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = dr.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      const v = measurementValue({ kind: dr.kind, points: pts }, cur);
      if (mp && v != null) { const [mx, my] = T(mp); tag(fmtQty(v, KIND_UNIT[dr.kind]), [mx + 44, my - 16], dr.color); }
    }
    for (const [line, color] of [[ruler.current, "#111111"], [calib, "#C2416D"]] as const) {
      if (!line) continue;
      const end = line[1] ?? mp;
      if (!end) continue;
      const a = T(line[0]), b = T(end);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
      ctx.setLineDash([]);
      const ppf = pointsPerFoot(cur);
      if (line === ruler.current && ppf) tag(feetInches(Math.hypot(end[0] - line[0][0], end[1] - line[0][1]) / ppf), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 14], color);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, markups, measures, sel, calib, markColor]);

  function snapPt(p: Pt): Pt {
    const prev = draft.current?.points.at(-1) ?? (ruler.current?.length === 1 ? ruler.current[0] : null) ?? (calib?.length === 1 ? calib[0] : null);
    if (!shift.current || !prev) return p;
    return Math.abs(p[0] - prev[0]) > Math.abs(p[1] - prev[1]) ? [p[0], prev[1]] : [prev[0], p[1]];
  }

  const fit = useCallback(() => {
    const st = stageRef.current;
    if (!st || !cur) return;
    const r = st.getBoundingClientRect();
    const k = Math.min(r.width / cur.width_pt, r.height / cur.height_pt) * 0.95;
    view.current = { k, x: (r.width - cur.width_pt * k) / 2, y: (r.height - cur.height_pt * k) / 2 };
  }, [cur]);

  // Size the canvas to its box.
  useEffect(() => {
    const st = stageRef.current, cv = canvasRef.current;
    if (!st || !cv) return;
    const ro = new ResizeObserver(() => {
      const r = st.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.max(1, r.width * d);
      cv.height = Math.max(1, r.height * d);
      draw();
    });
    ro.observe(st);
    return () => ro.disconnect();
  }, [draw]);

  // Render the current sheet from its PDF page.
  useEffect(() => {
    if (!cur || !curFile) return;
    fit();
    draw();
    if (renders.current.has(cur.id)) return;
    let stop = false;
    (async () => {
      try {
        setBusy("Loading sheet…");
        const { doc } = await loadDoc(curFile);
        const page = await doc.getPage(cur.page_number);
        const r = Math.min(4, 5000 / Math.max(cur.width_pt, cur.height_pt));
        const vp = page.getViewport({ scale: r });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
        if (stop) return;
        renders.current.set(cur.id, { canvas: c, r });
        draw();
      } catch (e) {
        setMsg({ error: (e as Error).message });
      } finally {
        setBusy("");
      }
    })();
    return () => { stop = true; };
  }, [cur, curFile, draw, fit, loadDoc]);

  useEffect(draw, [draw]);

  // ---------- saving ----------
  async function saveSheet(id: string, patch: Partial<Sheet>) {
    setSheets((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("plan_sheets").update(patch).eq("id", id);
    if (error) setMsg({ error: "Couldn't save the sheet. Try again." });
  }
  async function finishTakeoff() {
    const dr = draft.current;
    draft.current = null;
    if (!dr || !cur) return draw();
    const min = dr.kind === "area" ? 3 : dr.kind === "linear" ? 2 : 1;
    if (dr.points.length < min) return draw();
    const name = { linear: "Linear takeoff", area: "Area takeoff", count: "Count" }[dr.kind];
    const { data, error } = await supabase
      .from("takeoff_measurements")
      .insert({ project_id: props.projectId, sheet_id: cur.id, name, kind: dr.kind, color: dr.color, points: dr.points, created_by: props.meId })
      .select("id, sheet_id, name, kind, color, points, hidden")
      .single();
    if (error || !data) return setMsg({ error: "Couldn't save that takeoff. Try again." });
    setMeasures((all) => [...all, data as Measurement]);
    setSel(data.id);
    setTab("takeoff");
    setMsg({ ok: "Takeoff saved. Give it a name, then link it to line items in the estimate." });
    setTimeout(() => (document.querySelector(`[data-mname="${data.id}"]`) as HTMLInputElement | null)?.select(), 60);
  }
  async function saveMarkup(kind: MarkupKind, data: Markup["data"]) {
    if (!cur) return;
    const { data: row, error } = await supabase
      .from("plan_markups")
      .insert({ project_id: props.projectId, sheet_id: cur.id, kind, color: markColor, data, created_by: props.meId })
      .select("id, sheet_id, kind, color, data")
      .single();
    if (error || !row) return setMsg({ error: "Couldn't save that markup. Try again." });
    setMarkups((all) => [...all, row as Markup]);
  }
  async function updateMeasure(id: string, patch: Partial<Measurement>) {
    setMeasures((all) => all.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    const { error } = await supabase.from("takeoff_measurements").update(patch).eq("id", id);
    if (error) setMsg({ error: "Couldn't save. Try again." });
  }
  async function deleteMeasure(id: string) {
    const used = props.feeds[id]?.length;
    setMeasures((all) => all.filter((m) => m.id !== id));
    await supabase.from("takeoff_measurements").delete().eq("id", id);
    setMsg({ ok: used ? "Takeoff deleted. The line items that used it now keep their last quantity as a manual quantity." : "Takeoff deleted." });
  }
  async function undoMarkup() {
    const last = [...markups].reverse().find((m) => m.sheet_id === cur?.id);
    if (!last) return;
    setMarkups((all) => all.filter((m) => m.id !== last.id));
    await supabase.from("plan_markups").delete().eq("id", last.id);
  }
  async function clearMarkups() {
    if (!cur) return;
    setMarkups((all) => all.filter((m) => m.sheet_id !== cur.id));
    await supabase.from("plan_markups").delete().eq("sheet_id", cur.id);
  }

  // ---------- upload ----------
  async function upload(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setMsg({ error: "Plans need to be a PDF." });
    setMsg({});
    try {
      setBusy("Reading the PDF…");
      const bytes = await file.arrayBuffer();
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: bytes.slice(0) }).promise;
      const sizes: { w: number; h: number }[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
        sizes.push({ w: vp.width, h: vp.height });
      }
      setBusy(`Uploading ${doc.numPages} sheet${doc.numPages > 1 ? "s" : ""}…`);
      const path = `${props.projectId}/${crypto.randomUUID()}.pdf`;
      const up = await supabase.storage.from("plans").upload(path, file, { contentType: "application/pdf" });
      if (up.error) throw new Error("The upload failed. Check the file is under 200 MB and try again.");
      const name = file.name.replace(/\.pdf$/i, "");
      const { data: pf, error } = await supabase
        .from("plan_files")
        .insert({ project_id: props.projectId, name, storage_path: path, page_count: doc.numPages, uploaded_by: props.meId })
        .select("id, name, storage_path, page_count")
        .single();
      if (error || !pf) throw new Error("Couldn't save the plan set. Try again.");
      const start = sheets.length;
      const { data: rows, error: sErr } = await supabase
        .from("plan_sheets")
        .insert(sizes.map((s, i) => ({ plan_file_id: pf.id, project_id: props.projectId, page_number: i + 1, name: doc.numPages > 1 ? `${name} · p${i + 1}` : name, width_pt: s.w, height_pt: s.h, position: start + i })))
        .select("id, plan_file_id, page_number, name, width_pt, height_pt, scale_in_per_ft, points_per_foot, position");
      if (sErr || !rows) throw new Error("Couldn't save the sheets. Try again.");
      const { data: signed } = await supabase.storage.from("plans").createSignedUrl(path, 60 * 60 * 6);
      const newFile = { ...pf, url: signed?.signedUrl ?? "" } as PlanFile;
      docs.current.set(pf.id, Promise.resolve({ doc, bytes }));
      setFiles((all) => [...all, newFile]);
      setSheets((all) => [...all, ...(rows as Sheet[])]);
      setCurId(rows[0].id);
      setMsg({ ok: `${rows.length} sheet${rows.length > 1 ? "s" : ""} added. Set each sheet's scale before measuring.` });
    } catch (e) {
      setMsg({ error: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  // ---------- pointer input ----------
  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.current.x) / view.current.k, (e.clientY - r.top - view.current.y) / view.current.k];
  };
  const pan = useRef<{ sx: number; sy: number; x: number; y: number; moved: boolean; click: boolean } | null>(null);
  const lastTap = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number; x: number; y: number } | null>(null);

  function onDown(e: React.PointerEvent) {
    canvasRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = canvasRef.current!.getBoundingClientRect();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, x: view.current.x, y: view.current.y };
      pan.current = null;
      drag.current = null;
      return;
    }
    const markupDrag = ["pen", "line", "arrow", "rect", "cloud"].includes(tool);
    if (markupDrag && e.button === 0) {
      drag.current = { kind: tool as MarkupKind, points: [toPt(e)] };
      return;
    }
    pan.current = { sx: e.clientX, sy: e.clientY, x: view.current.x, y: view.current.y, moved: false, click: tool !== "pan" && e.button === 0 };
  }
  function onMove(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current;
    if (pc && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.min(10, Math.max(0.05, pc.k * (Math.hypot(a.x - b.x, a.y - b.y) / pc.d)));
      const ix = (pc.cx - pc.x) / pc.k, iy = (pc.cy - pc.y) / pc.k;
      view.current = { k, x: pc.cx - ix * k, y: pc.cy - iy * k };
      draw();
      return;
    }
    mouse.current = toPt(e);
    const dg = drag.current;
    if (dg) {
      if (dg.kind === "pen") dg.points.push(mouse.current);
      else dg.points = [dg.points[0], mouse.current];
    }
    const p = pan.current;
    if (p && (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 6 || !p.click)) {
      p.moved = true;
      view.current = { ...view.current, x: p.x + e.clientX - p.sx, y: p.y + e.clientY - p.sy };
    }
    draw();
  }
  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; return; }
    const dg = drag.current;
    if (dg) {
      drag.current = null;
      const pts = dg.kind === "pen" ? dg.points : [dg.points[0], toPt(e)];
      const big = Math.hypot(pts.at(-1)![0] - pts[0][0], pts.at(-1)![1] - pts[0][1]) * view.current.k > 6;
      if (big || (dg.kind === "pen" && pts.length > 3)) saveMarkup(dg.kind, { points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt) });
      draw();
      return;
    }
    const p = pan.current;
    pan.current = null;
    if (!p || p.moved || !p.click || !cur) return;
    const pt = snapPt(toPt(e));
    const now = Date.now(), dbl = now - lastTap.current < 320;
    lastTap.current = now;
    if (tool === "text") { setTextAt(pt); return; }
    if (tool === "ruler") { ruler.current = !ruler.current || ruler.current.length === 2 ? [pt] : [ruler.current[0], pt]; draw(); return; }
    if (tool === "calibrate") { setCalib((c) => (c?.length === 1 ? [c[0], pt] : [pt])); return; }
    if (tool !== "linear" && tool !== "area" && tool !== "count") return;
    if (tool !== "count" && !pointsPerFoot(cur)) { setMsg({ error: "Set this sheet's scale first (top right)." }); return; }
    if (!draft.current) draft.current = { kind: tool, points: [], color: TAKEOFF_COLORS[measures.length % TAKEOFF_COLORS.length] };
    const dr = draft.current;
    if (dbl && dr.kind !== "count" && dr.points.length >= 2) { finishTakeoff(); return; }
    if (dr.kind === "area" && dr.points.length >= 3 && Math.hypot(dr.points[0][0] - pt[0], dr.points[0][1] - pt[1]) * view.current.k < 12) { finishTakeoff(); return; }
    dr.points.push(pt);
    draw();
  }
  function onWheel(e: React.WheelEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [ix, iy] = [(sx - view.current.x) / view.current.k, (sy - view.current.y) / view.current.k];
    const k = Math.min(10, Math.max(0.05, view.current.k * Math.exp(-e.deltaY * 0.0015)));
    view.current = { k, x: sx - ix * k, y: sy - iy * k };
    draw();
  }
  function zoom(f: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    onWheel({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: -Math.log(f) / 0.0015 } as React.WheelEvent);
  }

  // Keyboard: Enter finishes, Escape cancels, Backspace undoes a point, Shift straightens.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shift.current = true;
      if ((e.target as HTMLElement).closest("input,select,textarea")) return;
      if (e.key === "Enter" && draft.current) finishTakeoff();
      if (e.key === "Escape") { draft.current = null; ruler.current = null; setCalib(null); setTextAt(null); draw(); }
      if (e.key === "Backspace" && draft.current) { draft.current.points.pop(); draw(); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shift.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });
  // Block the page from scrolling while zooming the plan.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    cv.addEventListener("wheel", stop, { passive: false });
    return () => cv.removeEventListener("wheel", stop);
  }, []);

  function pickTool(t: Tool) {
    if (draft.current) finishTakeoff();
    ruler.current = null;
    setCalib(null);
    setTextAt(null);
    setTool(t);
    if (["pen", "line", "arrow", "rect", "cloud", "text"].includes(t)) setTab("markup");
    if (["linear", "area", "count"].includes(t)) setTab("takeoff");
  }

  const sheetMeasures = measures.filter((m) => m.sheet_id === cur?.id);
  const sheetMarkups = markups.filter((m) => m.sheet_id === cur?.id);

  return (
    <div className="plans">
      <nav className="pl-sheets" aria-label="Plan sheets">
        <label className="btn" style={{ justifyContent: "center", cursor: "pointer" }}>
          + Upload plans
          <input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </label>
        {files.map((f) => (
          <div key={f.id} className="pl-set">
            <small className="pl-setname">{f.name}</small>
            {sheets.filter((s) => s.plan_file_id === f.id).map((s) => (
              <button key={s.id} className="pl-sheet" aria-current={s.id === curId} onClick={() => { draft.current = null; setCurId(s.id); setSel(null); }}>
                <b>{s.name}</b>
                <small className={pointsPerFoot(s) ? "" : "unscaled"}>{scaleLabel(s) ?? "Needs a scale"}</small>
                <small>{measures.filter((m) => m.sheet_id === s.id).length} takeoffs · {markups.filter((m) => m.sheet_id === s.id).length} markups</small>
              </button>
            ))}
          </div>
        ))}
        {!files.length && <p className="fine">Upload the drawings as a PDF. Each page becomes a sheet you can scale, measure and mark up.</p>}
      </nav>

      <section className="pl-main">
        <div className="pl-tools" role="toolbar" aria-label="Plan tools">
          {([["pan", "Pan"], ["linear", "Linear"], ["area", "Area"], ["count", "Count"], ["ruler", "Ruler"]] as [Tool, string][]).map(([t, l]) => (
            <button key={t} className="pl-tool" aria-pressed={tool === t} onClick={() => pickTool(t)} disabled={!cur}>{l}</button>
          ))}
          <span className="pl-sep" />
          {([["pen", "Pen"], ["arrow", "Arrow"], ["line", "Line"], ["rect", "Box"], ["cloud", "Cloud"], ["text", "Text"]] as [Tool, string][]).map(([t, l]) => (
            <button key={t} className="pl-tool" aria-pressed={tool === t} onClick={() => pickTool(t)} disabled={!cur}>{l}</button>
          ))}
          <span className="pl-colors" role="group" aria-label="Markup color">
            {MARKUP_COLORS.map((c) => (
              <button key={c} className="pl-color" style={{ background: c }} aria-pressed={markColor === c} aria-label={`Markup color ${c}`} onClick={() => setMarkColor(c)} />
            ))}
          </span>
          <span className="pl-scale">
            {cur && (
              <select
                aria-label="Sheet scale"
                value={cur.points_per_foot ? "cal" : cur.scale_in_per_ft ? String(cur.scale_in_per_ft) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "calnew") return pickTool("calibrate");
                  if (v && v !== "cal") saveSheet(cur.id, { scale_in_per_ft: Number(v), points_per_foot: null });
                }}
              >
                <option value="">Set scale…</option>
                {cur.points_per_foot && <option value="cal">Calibrated</option>}
                {SCALE_PRESETS.map((p) => <option key={p.value} value={String(p.value)}>{p.label}</option>)}
                <option value="calnew">Calibrate from two points…</option>
              </select>
            )}
          </span>
        </div>
        <div className="pl-stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            style={{ cursor: tool === "pan" ? "grab" : "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={cur ? `Plan sheet ${cur.name}` : "No sheet"}
          />
          {cur && <div className="pl-hint">{HINTS[tool]}</div>}
          {!cur && <div className="pl-empty">No plans yet. Upload a PDF to start a takeoff.</div>}
          {busy && <div className="pl-busy" role="status">{busy}</div>}
          <div className="pl-zoom">
            <button onClick={() => zoom(1.3)} aria-label="Zoom in">+</button>
            <button onClick={() => zoom(1 / 1.3)} aria-label="Zoom out">−</button>
            <button onClick={() => { fit(); draw(); }} aria-label="Fit sheet" style={{ fontSize: 11 }}>Fit</button>
          </div>
          {calib?.length === 2 && cur && (
            <CalibrateBox
              onCancel={() => { setCalib(null); setTool("pan"); }}
              onSet={(feet) => {
                const ppf = Math.hypot(calib[1][0] - calib[0][0], calib[1][1] - calib[0][1]) / feet;
                saveSheet(cur.id, { points_per_foot: ppf, scale_in_per_ft: null });
                setCalib(null);
                setTool("pan");
                setMsg({ ok: "Scale calibrated. Check it with the Ruler on another known dimension." });
              }}
            />
          )}
          {textAt && (
            <TextBox
              at={[view.current.x + textAt[0] * view.current.k, view.current.y + textAt[1] * view.current.k]}
              onCancel={() => setTextAt(null)}
              onSave={(text) => { saveMarkup("text", { x: textAt[0], y: textAt[1], text, size: 14 }); setTextAt(null); }}
            />
          )}
        </div>
        <div className="pl-status">
          {cur ? (
            <>
              <span><b>{cur.name}</b></span>
              <span>{scaleLabel(cur) ?? <b className="err">Not scaled</b>}</span>
              {msg.error && <span className="err" role="alert">{msg.error}</span>}
              {msg.ok && <span className="ok" role="status">{msg.ok}</span>}
            </>
          ) : (
            msg.error && <span className="err">{msg.error}</span>
          )}
        </div>
      </section>

      <aside className="pl-side">
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === "takeoff"} onClick={() => setTab("takeoff")}>Takeoff ({sheetMeasures.length})</button>
          <button className="tab" role="tab" aria-selected={tab === "markup"} onClick={() => setTab("markup")}>Markup ({sheetMarkups.length})</button>
        </div>
        <div className="pl-sidebody">
          {tab === "takeoff" ? (
            <>
              {measures.length ? (
                sheets.filter((s) => measures.some((m) => m.sheet_id === s.id)).map((s) => (
                  <div key={s.id} className="pl-group">
                    <small className="pl-setname">{s.name}</small>
                    {measures.filter((m) => m.sheet_id === s.id).map((m) => {
                      const v = measurementValue(m, s);
                      return (
                        <div key={m.id} className="pl-meas" aria-current={sel === m.id}>
                          <div className="pl-mh">
                            <input type="color" value={m.color} aria-label="Color" onChange={(e) => updateMeasure(m.id, { color: e.target.value })} />
                            <input
                              className="pl-mname"
                              data-mname={m.id}
                              defaultValue={m.name}
                              aria-label="Takeoff name"
                              onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && updateMeasure(m.id, { name: e.target.value.trim() })}
                              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            />
                            <span className="pl-mv">{v == null ? "—" : fmtQty(v, KIND_UNIT[m.kind])}</span>
                          </div>
                          <div className="pl-mm">
                            <button className="textbtn" onClick={() => { setCurId(s.id); setSel(m.id); }}>Show</button>
                            <button className="textbtn" onClick={() => updateMeasure(m.id, { hidden: !m.hidden })}>{m.hidden ? "Unhide" : "Hide"}</button>
                            <button className="textbtn" style={{ color: "#B3261E" }} onClick={() => deleteMeasure(m.id)}>Delete</button>
                          </div>
                          {props.feeds[m.id]?.length ? <small className="pl-feeds">Feeds {props.feeds[m.id].join(", ")}</small> : <small className="fine">Not in an estimate yet</small>}
                        </div>
                      );
                    })}
                  </div>
                ))
              ) : (
                <p className="fine">No takeoffs yet. Scale the sheet, pick Linear, Area or Count, and click on the plan.</p>
              )}
            </>
          ) : (
            <>
              <p className="fine">Markup is for notes: it doesn&apos;t measure anything. It goes out when you export a PDF.</p>
              <div className="actions" style={{ justifyContent: "flex-start" }}>
                <button className="linkbtn" onClick={undoMarkup} disabled={!sheetMarkups.length}>Undo last</button>
                <button className="linkbtn" onClick={clearMarkups} disabled={!sheetMarkups.length}>Clear this sheet</button>
              </div>
              <p className="fine">{sheetMarkups.length} markups on this sheet.</p>
            </>
          )}
          <div className="pl-export">
            <button className="btn" disabled={!cur} onClick={() => setExporting(true)}>Export PDF…</button>
            <small className="fine">Download a marked-up set, or send it to the client. Clients never see the Plans section; they only get what you send.</small>
          </div>
        </div>
      </aside>

      {exporting && cur && curFile && (
        <ExportDialog
          sheet={cur}
          file={curFile}
          sheets={sheets.filter((s) => s.plan_file_id === curFile.id)}
          measures={measures}
          markups={markups}
          chats={props.chats}
          jobLabel={props.jobLabel}
          loadDoc={loadDoc}
          projectId={props.projectId}
          meId={props.meId}
          onClose={(ok) => { setExporting(false); if (ok) { setMsg({ ok }); router.refresh(); } }}
        />
      )}
    </div>
  );
}

function CalibrateBox({ onSet, onCancel }: { onSet: (feet: number) => void; onCancel: () => void }) {
  const [ft, setFt] = useState("10");
  const [inch, setInch] = useState("0");
  const feet = (Number(ft) || 0) + (Number(inch) || 0) / 12;
  return (
    <form className="pl-dialog" onSubmit={(e) => { e.preventDefault(); if (feet > 0) onSet(feet); }}>
      <b>How long is the line you drew?</b>
      <div className="pl-row">
        <input value={ft} onChange={(e) => setFt(e.target.value)} inputMode="decimal" aria-label="Feet" autoFocus /> ft
        <input value={inch} onChange={(e) => setInch(e.target.value)} inputMode="decimal" aria-label="Inches" /> in
      </div>
      <div className="pl-row">
        <button className="btn" type="submit" disabled={feet <= 0}>Set scale</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
      <small className="fine">Use the longest dimension you can find: it makes every measurement more accurate.</small>
    </form>
  );
}

function TextBox({ at, onSave, onCancel }: { at: Pt; onSave: (t: string) => void; onCancel: () => void }) {
  const [t, setT] = useState("");
  return (
    <form className="pl-text" style={{ left: at[0], top: at[1] - 18 }} onSubmit={(e) => { e.preventDefault(); if (t.trim()) onSave(t.trim()); else onCancel(); }}>
      <input value={t} onChange={(e) => setT(e.target.value)} autoFocus placeholder="Type a note, press Enter" aria-label="Note text" onKeyDown={(e) => e.key === "Escape" && onCancel()} />
    </form>
  );
}

function ExportDialog(props: {
  sheet: Sheet; file: PlanFile; sheets: Sheet[]; measures: Measurement[]; markups: Markup[]; chats: { id: string; name: string }[];
  jobLabel: string; projectId: string; meId: string;
  loadDoc: (f: PlanFile) => Promise<{ doc: PDFDocumentProxy; bytes: ArrayBuffer }>;
  onClose: (ok?: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [which, setWhich] = useState<"this" | "marked" | "all">("this");
  const [withMeasures, setWithMeasures] = useState(false);
  const [name, setName] = useState(`${props.jobLabel || "Plans"} - ${props.sheet.name}`.replace(/[\\/:*?"<>|]/g, "-"));
  const [dest, setDest] = useState<"download" | "client">("download");
  const [chat, setChat] = useState(props.chats[0]?.id ?? "");
  const [note, setNote] = useState("Here are the marked-up plans.");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const pages = props.sheets.filter((s) =>
    which === "this" ? s.id === props.sheet.id : which === "marked" ? props.markups.some((m) => m.sheet_id === s.id) || (withMeasures && props.measures.some((m) => m.sheet_id === s.id)) : true,
  );

  async function go() {
    if (!pages.length) return setError("None of the sheets in this set have markup yet.");
    setError("");
    try {
      setBusy("Building the PDF…");
      const { doc, bytes } = await props.loadDoc(props.file);
      const { exportPlanPdf } = await import("@/lib/plan-export");
      const out = await exportPlanPdf(
        bytes,
        doc,
        pages.map((s) => ({ pageNumber: s.page_number, sheet: s, markups: props.markups.filter((m) => m.sheet_id === s.id), measurements: props.measures.filter((m) => m.sheet_id === s.id) })),
        withMeasures,
      );
      const fileName = `${name.trim() || "Plans"}.pdf`;
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
      if (dest === "download") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        return props.onClose(`Downloaded ${fileName}.`);
      }
      setBusy("Sending to the client…");
      // Posted in the chosen client chat (the client gets the usual notification),
      // and filed under Drawings where the client can see it.
      let messageId: string | null = null;
      if (chat) {
        const { data: m, error: mErr } = await supabase.from("messages").insert({ chat_id: chat, author_id: props.meId, body: note.trim() }).select("id").single();
        if (mErr || !m) throw new Error("Couldn't post in that chat. Try again.");
        messageId = m.id;
      }
      const path = storagePath(props.projectId, fileName);
      const up = await supabase.storage.from(FILES_BUCKET).upload(path, blob, { contentType: "application/pdf" });
      if (up.error) throw new Error("The upload failed. Try again.");
      const { error: fErr } = await supabase.from("files").insert({
        project_id: props.projectId, message_id: messageId, name: fileName, storage_path: path, size_bytes: blob.size,
        mime_type: "application/pdf", folder: "Drawings", is_internal: false, uploaded_by: props.meId,
      });
      if (fErr) throw new Error("The PDF uploaded, but couldn't be added to the project's files. Try again.");
      props.onClose(`Sent ${fileName} to the client${chat ? ` in ${props.chats.find((c) => c.id === chat)?.name}` : ""}. It's in the project's Drawings too.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Export PDF" style={{ maxWidth: 520 }}>
        <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 500 }}>Export PDF</h2>
        <div className="form" style={{ maxWidth: "none" }}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Sheets</legend>
            {([["this", `This sheet (${props.sheet.name})`], ["marked", "Sheets in this set with markup"], ["all", `Every sheet in ${props.file.name}`]] as const).map(([v, l]) => (
              <label key={v} style={{ fontWeight: 400, display: "flex", gap: 8 }}><input type="radio" checked={which === v} onChange={() => setWhich(v)} />{l}</label>
            ))}
          </fieldset>
          <label style={{ display: "flex", gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={withMeasures} onChange={(e) => setWithMeasures(e.target.checked)} /> Include takeoff measurements (lengths, areas and counts)
          </label>
          <label className="field">File name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Then</legend>
            <label style={{ fontWeight: 400, display: "flex", gap: 8 }}><input type="radio" checked={dest === "download"} onChange={() => setDest("download")} />Download it</label>
            <label style={{ fontWeight: 400, display: "flex", gap: 8 }}><input type="radio" checked={dest === "client"} onChange={() => setDest("client")} />Send it to the client in OnSite</label>
          </fieldset>
          {dest === "client" && (
            <>
              <label className="field">
                Post in
                <select value={chat} onChange={(e) => setChat(e.target.value)}>
                  {props.chats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="">Don&apos;t post, just add it to the client&apos;s files</option>
                </select>
              </label>
              {chat && <label className="field">Message<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
            </>
          )}
          <p className="fine">{pages.length} sheet{pages.length === 1 ? "" : "s"} will be in the PDF.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="actions">
            <button className="btn ghost" onClick={() => props.onClose()}>Cancel</button>
            <button className="btn" onClick={go} disabled={!!busy}>{busy || (dest === "download" ? "Download PDF" : "Send to client")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
