"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import NewEstimate from "./NewEstimate";

// "+ New document" opens the three steps in a drop-down under the button.
export default function NewDocumentMenu({ startOpen = false, ...props }: ComponentProps<typeof NewEstimate> & { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);
  return (
    <div className="newdoc" ref={ref}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>+ New document {open ? "▴" : "▾"}</button>
      {open && (
        <div className="newdoc-menu" role="dialog" aria-label="New document">
          <div className="sec-h" style={{ marginBottom: 4 }}><h2>New document</h2><button className="textbtn" onClick={() => setOpen(false)}>Close</button></div>
          <NewEstimate {...props} />
        </div>
      )}
    </div>
  );
}
