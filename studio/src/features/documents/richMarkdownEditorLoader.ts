import { lazy } from "react";

// Both document surfaces share the module and its in-flight preload. Warming
// code does not mount an editor or create another draft.
let pending: Promise<typeof import("./RichMarkdownEditor")> | undefined;
export function preloadRichMarkdownEditor() {
  return pending ??= import("./RichMarkdownEditor").catch((error) => {
    pending = undefined;
    throw error;
  });
}

export const LazyRichMarkdownEditor = lazy(preloadRichMarkdownEditor);

export function warmRichMarkdownEditorAfterPaint(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    // A task after rAF lets the read view paint before editor evaluation.
    timer = setTimeout(() => {
      void preloadRichMarkdownEditor().catch(() => {
        // Speculative loading may fail; clicking the description can retry.
      });
    }, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
