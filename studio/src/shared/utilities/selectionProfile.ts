/**
 * Selection-latency probe. A no-op unless a harness (the arrow-hold Playwright
 * profile, or a devtools session) installs `__ticketrySelectionProfileProbe`
 * on `globalThis`; each call then lands as a timestamped point in that harness.
 */
export function recordSelectionProfilePoint(point: string): void {
  (globalThis as typeof globalThis & {
    __ticketrySelectionProfileProbe?: (point: string) => void;
  }).__ticketrySelectionProfileProbe?.(point);
}
