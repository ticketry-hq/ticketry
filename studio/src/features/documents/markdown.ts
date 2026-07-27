import { marked } from "marked";
import type TurndownService from "turndown";
import DOMPurify from "isomorphic-dompurify";

// C5 (#640): pure-FE markdown round-trip for the issue-description drawer.
// `description_html` stays the only persisted field — we render markdown to
// HTML on save and turn the stored HTML back into markdown to seed re-edits.
// Both directions are best-effort/lossy by design (basic CommonMark scope).

marked.setOptions({ gfm: false, breaks: true });

// turndown is only needed once the user actually starts editing stored HTML,
// so it loads on demand instead of riding along with the read view's chunk.
let turndownLoader: Promise<TurndownService> | null = null;
const loadTurndown = () =>
  (turndownLoader ??= import("turndown").then(
    ({ default: Turndown }) =>
      new Turndown({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
      }),
  ));

// markdown source → HTML string to persist as `description_html`.
export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

// stored `description_html` → markdown to seed the editor textarea.
export async function htmlToMarkdown(html: string): Promise<string> {
  return (await loadTurndown()).turndown(html);
}

// Sanitize any HTML before it reaches `dangerouslySetInnerHTML` — used for both
// the read view (stored HTML) and the live preview (freshly rendered markdown).
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

// Convenience for the preview pane: render markdown and sanitize in one step.
export function renderMarkdown(md: string): string {
  return sanitizeHtml(markdownToHtml(md));
}
