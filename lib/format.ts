import type { Folder } from "./constants";

export const TZ = "America/New_York";

export function initials(name: string) {
  const words = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return (words.map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
}

// A stable avatar color per person.
export function avatarTone(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 5) + 1;
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function todayLabel(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ }).format(now);
}

export function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ }).format(new Date(iso));
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TZ }).format(new Date(iso));
}

export function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

export function fileExt(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.slice(0, 4).toLowerCase() : "file";
}

export function fileSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function isImage(mime: string | null, name: string) {
  // HEIC/HEIF only display in Safari, so treat them as downloads elsewhere.
  if (mime && /^image\/(jpe?g|png|gif|webp|avif)$/i.test(mime)) return true;
  return /\.(jpe?g|png|gif|webp|avif)$/i.test(name);
}

export function guessFolder(name: string): Folder {
  const n = name.toLowerCase();
  if (/\.(jpe?g|png|heic|heif|gif|webp|mov|mp4)$/.test(n)) return "Photos";
  if (/permit|inspect/.test(n)) return "Permits & inspections";
  if (/contract|proposal|quote|change order/.test(n)) return "Contracts";
  if (/spec|submittal|shop draw|cut sheet/.test(n)) return "Submittals";
  return "Drawings";
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function storagePath(projectId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120);
  return `${projectId}/${crypto.randomUUID()}-${safe}`;
}

// Message text as plain words, for previews, emails and phone notifications
// (messages are written as Markdown in the editor).
export function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>)\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "• ")
    .replace(/^\s*([-*_]\s*){3,}$/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
