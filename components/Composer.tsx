"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { ClipIcon } from "./Icons";

type Props = {
  placeholder: string;
  hint: React.ReactNode;
  error: string;
  internal: boolean;
  // Posts the message (Markdown) with any attached files; resolves true when it went through.
  onPost: (markdown: string, files: File[]) => Promise<boolean>;
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

function Toolbar({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      heading: e.isActive("heading"),
      link: e.isActive("link"),
      quote: e.isActive("blockquote"),
      code: e.isActive("code") || e.isActive("codeBlock"),
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
      <span className="sep" />
      {btn("Link", st.link, link, <Ico d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" />)}
      {btn("Quote", st.quote, () => chain().toggleBlockquote().run(), <Ico d="M3 5h3v3H4v3M9 5h3v3h-2v3" />)}
      {btn("Code", st.code, () => chain().toggleCode().run(), <Ico d="M6 4L2 8l4 4M10 4l4 4-4 4" />)}
      <span className="sep" />
      {btn("Bulleted list", st.bullets, () => chain().toggleBulletList().run(), <Ico d="M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />)}
      {btn("Numbered list", st.numbers, () => chain().toggleOrderedList().run(), <Ico d="M6 4h8M6 8h8M6 12h8M2 3l1-.5V6M2 9.5c.5-.7 2-.6 1.8.4L2 12h2" />)}
      {btn("Divider", false, () => chain().setHorizontalRule().run(), <Ico d="M2 8h12" />)}
    </div>
  );
}

// A Basecamp-style writing box: formatting toolbar, room to write, attachments
// collected before posting. Enter makes a new line; Post (or Ctrl/Cmd+Enter) sends.
export default function Composer({ placeholder, hint, error, internal, onPost, dropped, onDroppedTaken }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const postRef = useRef<() => void>(() => {});
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    editorProps: {
      attributes: { class: "md editor", "aria-label": "Message" },
      handleKeyDown: (_view, e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          postRef.current();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!dropped.length) return;
    setFiles((f) => [...f, ...dropped]);
    onDroppedTaken();
  }, [dropped, onDroppedTaken]);

  async function post() {
    if (!editor || posting) return;
    const markdown = editor.isEmpty ? "" : editor.getMarkdown().trim();
    if (!markdown && !files.length) return;
    setPosting(true);
    const ok = await onPost(markdown, files);
    setPosting(false);
    if (ok) {
      editor.commands.clearContent();
      setFiles([]);
      editor.commands.focus();
    }
  }
  postRef.current = post;

  return (
    <div className={`compose rich ${internal ? "int" : ""}`}>
      <div className="editbox">
        {editor && <Toolbar editor={editor} />}
        <EditorContent editor={editor} />
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
        {error ? <div className="err">{error}</div> : <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}
