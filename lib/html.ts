import sanitizeHtml from "sanitize-html";

// Only the formatting the editor can make survives: no scripts, images,
// classes or arbitrary styles — just text color and highlight.
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^inherit$/i];
export const SAFE_HTML: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "s", "u", "h3", "ul", "ol", "li", "blockquote", "hr", "a", "span", "mark", "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td"],
  allowedAttributes: { a: ["href"], span: ["style"], mark: ["style"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] },
  allowedStyles: { span: { color: COLOR }, mark: { "background-color": COLOR, color: COLOR } },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }) },
};

export function cleanHtml(html: string) {
  return sanitizeHtml(html, SAFE_HTML);
}
