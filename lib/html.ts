import sanitizeHtml from "sanitize-html";

// Only the formatting the editor can make survives: no scripts, images,
// classes or arbitrary styles — just text color and highlight.
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^inherit$/i];
export const SAFE_HTML: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "s", "u", "h3", "ul", "ol", "li", "blockquote", "hr", "a", "span", "mark", "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td", "img"],
  // Pictures only ever point at a project file (data-path); the link to show
  // it is added when the message is displayed.
  allowedAttributes: { a: ["href"], span: ["style"], mark: ["style"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"], img: ["data-path"] },
  allowedStyles: { span: { color: COLOR }, mark: { "background-color": COLOR, color: COLOR } },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }) },
};

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Cleans a message and shows its pictures with their signed links (`urls`,
// by storage path). A picture the viewer has no link for shows as a label.
export function cleanHtml(html: string, urls: Record<string, string> = {}) {
  return sanitizeHtml(html, SAFE_HTML).replace(/<img(?: data-path="([^"]*)")?\s*\/?>/g, (_m, path?: string) => {
    const url = path ? urls[path.replace(/&amp;/g, "&")] : undefined;
    return url
      ? `<a class="inline-pic" href="${attr(url)}" target="_blank" rel="noreferrer"><img src="${attr(url)}" alt="Picture" loading="lazy"></a>`
      : `<span class="inline-pic missing">Picture</span>`;
  });
}
