import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// A message's text, written in the editor as Markdown. Raw HTML is never
// rendered, and unsafe link schemes are dropped by react-markdown.
export default function MessageBody({ text }: { text: string }) {
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
