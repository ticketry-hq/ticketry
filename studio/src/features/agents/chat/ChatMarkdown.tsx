/**
 * Markdown presentation adapted from `pingdotgg/t3code`
 * `apps/web/src/components/ChatMarkdown.tsx` at revision
 * 45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b (MIT; see
 * `third_party/t3code/LICENSE`). Ticketry uses its existing marked + DOMPurify
 * stack in place of T3's ReactMarkdown plugin graph.
 */

import { memo, useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const html = useMemo(() => DOMPurify.sanitize(
    marked.parse(text, { async: false, breaks: true, gfm: true }) as string,
  ), [text]);

  return (
    <div className="relative min-w-0">
      <div
        className="md-body min-w-0 break-words text-sm leading-relaxed text-text-primary [&_pre]:max-w-full [&_pre]:overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {streaming ? (
        <span
          aria-label="Response streaming"
          className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-focus-accent align-text-bottom"
        />
      ) : null}
    </div>
  );
});
