import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Reports viewer-focus intent into the desktop process log.
 *
 * AppKit first-responder moves are invisible to the webview, and the app's own
 * reasons for hiding, showing, or focusing a viewer are invisible to AppKit.
 * Both halves write to the same stderr log so a spontaneous focus loss can be
 * attributed to app state or to something outside it. Printing is decided by
 * the desktop process (`MUXED_TERMINAL_FOCUS_TRACE=1`); this side only reports,
 * and only from a development build.
 */
export function traceViewerFocus(
  event: string,
  detail: Record<string, unknown>,
): void {
  // `isTauri` is absent from the narrow core mocks the viewer tests install, so
  // tracing checks for it rather than assuming the whole module surface.
  if (!import.meta.env.DEV || typeof isTauri !== "function" || !isTauri()) {
    return;
  }
  const rendered = Object.entries(detail)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  void invoke("native_terminal_trace", {
    event: `webview ${event}`,
    detail: rendered,
  }).catch(() => {
    /* Tracing must never affect the session it observes. */
  });
}

/** Names the DOM element holding focus, for attributing a keyboard steal. */
export function activeElementLabel(): string {
  const element = document.activeElement;
  if (!element) return "<none>";
  if (element === document.body) return "body";
  const attributes = ["data-testid", "data-navigation-zone", "data-pane", "id"]
    .map((name) => {
      const value = element.getAttribute(name);
      return value ? `${name}=${value}` : null;
    })
    .filter(Boolean)
    .join(",");
  return attributes ? `${element.tagName}[${attributes}]` : element.tagName;
}
