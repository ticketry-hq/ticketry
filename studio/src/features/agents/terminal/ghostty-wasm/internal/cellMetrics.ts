/**
 * CODING-1304 — the cell box for a monospace font.
 *
 * Measured the same way xterm sizes its own cells: a hidden DOM span in the
 * page's own font stack. Deriving the box from a guessed line-height factor
 * instead made every row taller than the fallback renderer's, so the same run
 * looked looser and fit fewer rows in the same panel. Sharing the measurement
 * keeps the two renderers geometrically interchangeable.
 *
 * The baseline still comes from the canvas font metrics, because a span
 * reports no baseline: the font's ascent/descent box is centred in the cell.
 */
export interface CellMetrics {
  width: number;
  height: number;
  baseline: number;
}

export interface CellFont {
  fontFamily: string;
  fontSize: number;
}

/** Only the parts of a 2d context this measurement needs. */
export interface MetricsContext {
  font: string;
  measureText(text: string): TextMetrics;
}

const SAMPLE = "W".repeat(32);

export function measureCellMetrics(font: CellFont, context: MetricsContext): CellMetrics {
  context.font = `${font.fontSize}px ${font.fontFamily}`;
  const box = measureBox(font, context);
  return { ...box, baseline: baselineWithin(box.height, font, context) };
}

function measureBox(font: CellFont, context: MetricsContext): { width: number; height: number } {
  const span = measureSpan(font);
  if (span) return span;
  // jsdom and worker contexts have no layout; fall back to the canvas so the
  // geometry maths stays finite.
  const width = context.measureText("M").width;
  return {
    width: width > 0 ? width : font.fontSize * 0.6,
    height: Math.ceil(font.fontSize * 1.2),
  };
}

function measureSpan(font: CellFont): { width: number; height: number } | null {
  if (typeof document === "undefined" || !document.body) return null;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.top = "-9999px";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.lineHeight = "normal";
  probe.style.fontFamily = font.fontFamily;
  probe.style.fontSize = `${font.fontSize}px`;
  probe.textContent = SAMPLE;
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  const width = rect.width / SAMPLE.length;
  const height = Math.ceil(rect.height);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function baselineWithin(height: number, font: CellFont, context: MetricsContext): number {
  const metrics = context.measureText("Mg");
  const ascent = firstPositive(
    metrics.fontBoundingBoxAscent,
    metrics.actualBoundingBoxAscent,
    font.fontSize * 0.8,
  );
  const descent = firstPositive(
    metrics.fontBoundingBoxDescent,
    metrics.actualBoundingBoxDescent,
    font.fontSize * 0.2,
  );
  const centred = (height - (ascent + descent)) / 2 + ascent;
  return Math.min(height - 1, Math.max(1, Math.round(centred)));
}

function firstPositive(...values: (number | undefined)[]): number {
  for (const value of values) {
    if (typeof value === "number" && value > 0) return value;
  }
  return 1;
}
