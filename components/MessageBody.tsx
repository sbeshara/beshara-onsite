import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { isHtml } from "@/lib/format";
import { cleanHtml } from "@/lib/html";

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
