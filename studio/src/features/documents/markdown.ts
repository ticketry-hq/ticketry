import { marked } from "marked";
import type TurndownService from "turndown";
import DOMPurify from "isomorphic-dompurify";

// Markdown rendering for descriptions and documents. The HTML-to-Markdown
// direction exists only to normalize legacy HTML descriptions on first edit.

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

// Markdown source → HTML for sanitized presentation.
export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

// Legacy stored HTML → Markdown to seed the editor textarea.
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
