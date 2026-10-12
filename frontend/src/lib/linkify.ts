export type LinkifyPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

// Bare domains only linkify for common TLDs, so things like "file.txt" or "v1.2" stay text.
const TLDS = [
  "com", "net", "org", "io", "dev", "app", "co", "me", "tv", "gg", "ai", "xyz", "info", "edu", "gov",
  "tr", "de", "uk", "us", "eu", "fr", "nl", "ru", "jp", "ca", "au", "in", "br", "es", "it", "be", "ch", "at", "se", "pl",
  "link", "site", "online", "store", "tech", "blog", "live", "news", "cloud",
].join("|");

const LINK_RE = new RegExp(
  [
    String.raw`https?:\/\/[^\s<>"]+`,
    // Not preceded by a word char, @ (emails), / or . (part of a longer token).
    String.raw`(?<![\w@/.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS})(?![\w-])(?:[/?#][^\s<>"]*)?`,
  ].join("|"),
  "gi",
);
/** Drops sentence punctuation after a link, keeping a ")" that closes one inside it. */
function trimTrailing(raw: string): string {
  let end = raw.length;
  while (end > 0 && `.,!?;:'")]`.includes(raw[end - 1])) {
    const s = raw.slice(0, end);
    if (raw[end - 1] === ")" && s.split("(").length >= s.split(")").length) break;
    end--;
  }
  return raw.slice(0, end);
}

/** Splits message text into plain text and links. Bare domains get an https:// href. */
export function linkify(text: string): LinkifyPart[] {
  const parts: LinkifyPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const raw = trimTrailing(match[0]);
    if (!raw) continue;
    const start = match.index;
    if (start > last) parts.push({ type: "text", text: text.slice(last, start) });
    parts.push({ type: "link", text: raw, href: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
