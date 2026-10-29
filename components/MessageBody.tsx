import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";
import { isHtml } from "@/lib/format";

// Only the formatting the editor can make survives: no scripts, images,
// classes or arbitrary styles — just text color and highlight.
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^inherit$/i];
const SAFE: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "s", "u", "h3", "ul", "ol", "li", "blockquote", "hr", "a", "span", "mark", "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td"],
  allowedAttributes: { a: ["href"], span: ["style"], mark: ["style"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] },
  allowedStyles: { span: { color: COLOR }, mark: { "background-color": COLOR, color: COLOR } },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }) },
};

export function cleanHtml(html: string) {
  return sanitizeHtml(html, SAFE);
}

// A message's text. New messages are HTML from the editor (cleaned before it
// is shown); older ones are Markdown, where raw HTML is never rendered.
export default function MessageBody({ text }: { text: string }) {
  if (isHtml(text)) return <div className="body md" dangerouslySetInnerHTML={{ __html: cleanHtml(text) }} />;
  return (
    <div className="body md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
