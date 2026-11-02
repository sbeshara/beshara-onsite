"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { ClipIcon } from "./Icons";

type Props = {
  placeholder: string;
  hint: React.ReactNode;
  error: string;
  internal: boolean;
  // Posts the message (HTML) with any attached files and the pictures placed in
  // the text (each marked data-pending="<id>" in the HTML); resolves true when it went through.
  onPost: (html: string, files: File[], inline: { id: string; file: File }[]) => Promise<boolean>;
  // Files dropped onto the thread land here.
  dropped: File[];
  onDroppedTaken: () => void;
};

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Ico = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" {...s} aria-hidden="true">
    <path d={d} />
  </svg>
);

const TEXT_COLORS = [
  ["Black", ""],
  ["Gray", "#6b7280"],
  ["Red", "#d92d20"],
  ["Orange", "#e8590c"],
  ["Green", "#2f9e44"],
  ["Blue", "#1c7ed6"],
  ["Purple", "#7048e8"],
  ["Brown", "#8b5a2b"],
];
const HIGHLIGHTS = [
  ["No highlight", ""],
  ["Yellow", "#fff3a3"],
  ["Green", "#c9f2d0"],
  ["Blue", "#cfe8ff"],
  ["Pink", "#ffd6e7"],
  ["Orange", "#ffe1c2"],
  ["Gray", "#e9ecef"],
];
export const BODY_LIMIT = 10000;

// Pictures pasted or dropped into the text. Until the message is posted they
// show from the computer (data-pending); once uploaded they point at the
// project file (data-path), which is shown with a signed link.
const InlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: { default: null, parseHTML: (el) => el.getAttribute("data-path"), renderHTML: (a) => (a.path ? { "data-path": a.path } : {}) },
      pending: { default: null, parseHTML: (el) => el.getAttribute("data-pending"), renderHTML: (a) => (a.pending ? { "data-pending": a.pending } : {}) },
    };
  },
}).configure({ inline: false, allowBase64: false });

const isImageFile = (f: File) => f.type.startsWith("image/");

function Toolbar({ editor, onPicture }: { editor: Editor; onPicture: (files: File[]) => void }) {
  const [colors, setColors] = useState(false);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      heading: e.isActive("heading"),
      link: e.isActive("link"),
      quote: e.isActive("blockquote"),
      table: e.isActive("table"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
    }),
  });
  const chain = () => editor.chain().focus();
  const link = () => {
    if (editor.isActive("link")) return chain().unsetLink().run();
    const url = window.prompt("Link address", "https://");
    if (!url || url === "https://") return;
    chain().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
  };
  const btn = (label: string, on: boolean, run: () => void, icon: React.ReactNode) => (
    <button type="button" className="tb" aria-label={label} title={label} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </button>
  );
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {btn("Bold", st.bold, () => chain().toggleBold().run(), <b>B</b>)}
      {btn("Italic", st.italic, () => chain().toggleItalic().run(), <i>I</i>)}
      {btn("Strikethrough", st.strike, () => chain().toggleStrike().run(), <s>S</s>)}
      {btn("Heading", st.heading, () => chain().toggleHeading({ level: 3 }).run(), <span className="tt">T<small>T</small></span>)}
      <span className="tb-wrap">
        {btn(
          "Text color and highlight",
          colors,
          () => setColors(!colors),
          <span className="tb-color" style={{ borderColor: st.color || "currentColor" }}>A</span>,
        )}
        {colors && (
          <div className="swatches" role="dialog" aria-label="Colors" onMouseDown={(e) => e.preventDefault()}>
            <div className="sw-label">Text Color</div>
            <div className="sw-row">
              {TEXT_COLORS.map(([name, c]) => (
                <button
                  key={name}
                  type="button"
                  className="sw"
                  title={name}
                  aria-label={`Text ${name}`}
                  style={{ background: c || "var(--ink, #1a1a1a)" }}
                  onClick={() => {
                    (c ? chain().setColor(c) : chain().unsetColor()).run();
                    setColors(false);
                  }}
                />
              ))}
            </div>
            <div className="sw-label">Highlight</div>
            <div className="sw-row">
              {HIGHLIGHTS.map(([name, c]) => (
                <button
                  key={name}
                  type="button"
                  className={`sw ${c ? "" : "none"}`}
                  title={name}
                  aria-label={c ? `Highlight ${name}` : name}
                  style={c ? { background: c } : undefined}
                  onClick={() => {
                    (c ? chain().setHighlight({ color: c }) : chain().unsetHighlight()).run();
                    setColors(false);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </span>
      <span className="sep" />
      {btn("Link", st.link, link, <Ico d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" />)}
      {btn("Quote", st.quote, () => chain().toggleBlockquote().run(), <Ico d="M3 5h3v3H4v3M9 5h3v3h-2v3" />)}
      <span className="sep" />
      {btn("Bulleted list", st.bullets, () => chain().toggleBulletList().run(), <Ico d="M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />)}
      {btn("Numbered list", st.numbers, () => chain().toggleOrderedList().run(), <Ico d="M6 4h8M6 8h8M6 12h8M2 3l1-.5V6M2 9.5c.5-.7 2-.6 1.8.4L2 12h2" />)}
      {btn("Divider", false, () => chain().setHorizontalRule().run(), <Ico d="M2 8h12" />)}
      <label className="tb" title="Insert picture in the text" aria-label="Insert picture" onMouseDown={(e) => e.preventDefault()}>
        <Ico d="M2 3h12v10H2zM2 11l3.5-3.5 2.5 2.5 2-2 4 4M10.5 6.5h.01" />
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])].filter(isImageFile);
            e.target.value = "";
            onPicture(picked);
          }}
        />
      </label>
      {btn("Table", st.table, () => (st.table ? undefined : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), <Ico d="M2 3h12v10H2zM2 6.5h12M2 10h12M6 3v10M10 3v10" />)}
      {st.table && (
        <span className="tb-table" aria-label="Table tools">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()}>+ Row</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()}>+ Column</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()}>− Row</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()}>− Column</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteTable().run()}>Delete Table</button>
        </span>
      )}
    </div>
  );
}

// A Basecamp-style writing box: formatting toolbar, room to write, attachments
// collected before posting. Enter makes a new line; Post (or Ctrl/Cmd+Enter) sends.
export default function Composer({ placeholder, hint, error, internal, onPost, dropped, onDroppedTaken }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(true);
  const postRef = useRef<() => void>(() => {});
  const inline = useRef(new Map<string, { file: File; url: string }>());
  const editorRef = useRef<Editor | null>(null);
  // Puts pictures into the text where the cursor is.
  const addPictures = (pics: File[]) => {
    const ed = editorRef.current;
    if (!ed) return;
    for (const file of pics) {
      const id = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      inline.current.set(id, { file, url });
      ed.chain().focus().setImage({ src: url, alt: file.name, pending: id } as Parameters<typeof ed.commands.setImage>[0]).run();
    }
  };
  const editor = useEditor({
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, code: false, codeBlock: false, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: false } }),
      InlineImage,
    ],
    editorProps: {
      attributes: { class: "md editor", "aria-label": "Message" },
      // Pasted or dropped pictures go into the text; other dropped files are attachments.
      handlePaste: (_view, e) => {
        const pics = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
        if (!pics.length) return false;
        addPictures(pics);
        return true;
      },
      handleDrop: (view, e, _slice, moved) => {
        const dropped = [...(e.dataTransfer?.files ?? [])];
        if (moved || !dropped.length) return false;
        e.preventDefault();
        const pics = dropped.filter(isImageFile);
        const others = dropped.filter((f) => !isImageFile(f));
        if (others.length) setFiles((f) => [...f, ...others]);
        if (pics.length) {
          const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (at) editorRef.current?.commands.setTextSelection(at.pos);
          addPictures(pics);
        }
        return true;
      },
      handleKeyDown: (_view, e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          postRef.current();
          return true;
        }
        return false;
      },
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!dropped.length) return;
    setFiles((f) => [...f, ...dropped]);
    onDroppedTaken();
  }, [dropped, onDroppedTaken]);

  async function post() {
    if (!editor || posting) return;
    const html = editor.isEmpty ? "" : editor.getHTML().replace(/(<p><\/p>)+$/, "");
    if (!html && !files.length) return;
    if (html.length > BODY_LIMIT) {
      setTooLong(true);
      return;
    }
    setTooLong(false);
    setPosting(true);
    const pics = [...inline.current].filter(([id]) => html.includes(`data-pending="${id}"`)).map(([id, v]) => ({ id, file: v.file }));
    const ok = await onPost(html, files, pics);
    setPosting(false);
    if (ok) {
      editor.commands.clearContent();
      setEmpty(true);
      setFiles([]);
      for (const v of inline.current.values()) URL.revokeObjectURL(v.url);
      inline.current.clear();
      editor.commands.focus();
    }
  }
  postRef.current = post;

  return (
    <div className={`compose rich ${internal ? "int" : ""} ${!focused && empty && !files.length ? "idle" : ""}`}>
      <div className="editbox">
        {editor && <Toolbar editor={editor} onPicture={addPictures} />}
        <EditorContent editor={editor} className="editor-wrap" />
        {files.length > 0 && (
          <div className="pending">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="pfile">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="compose-actions">
        <label className="btn ghost attachbtn" title="Attach photos or files">
          <ClipIcon /> Attach
          <input
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = "";
              setFiles((f) => [...f, ...picked]);
            }}
          />
        </label>
        <button className="btn" type="button" disabled={posting} onClick={post}>
          {posting ? "Posting…" : "Post"}
        </button>
        {tooLong ? (
          <div className="err">That message is too long to post. Split it into two, or attach it as a file.</div>
        ) : error ? (
          <div className="err">{error}</div>
        ) : (
          <div className="hint">{hint}</div>
        )}
      </div>
    </div>
  );
}
