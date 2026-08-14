export type NativeTerminalFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

/** Measure the mounted host and clip it to the current webview viewport. */
export function clippedNativeTerminalFrame(
  host: HTMLElement,
): NativeTerminalFrame | null {
  const rect = host.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (right <= x || bottom <= y) return null;
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}
