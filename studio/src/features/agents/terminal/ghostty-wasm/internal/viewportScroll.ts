/**
 * CODING-1304 — the arithmetic of pixel-smooth viewport scrolling.
 *
 * A wheel gesture is continuous but a terminal viewport moves in whole rows.
 * This module keeps the continuous part: it accumulates the gesture in pixels
 * and splits it into the two things the renderer can act on — how many whole
 * rows to move Ghostty's viewport by, and how many pixels of the gesture are
 * left over for the painter to shift the grid by.
 *
 * Deliberately DOM-free and terminal-free: no `WheelEvent`, no wasm handle, no
 * canvas. That is what makes the direction conventions testable in isolation.
 *
 * ## Direction conventions
 *
 * - `WheelEvent.deltaY` is negative when the user scrolls up, and scrolling up
 *   means moving *back* into scrollback. `distancePx` below is therefore
 *   `-deltaY` accumulated, and is never negative: zero is the live bottom.
 * - `ViewportScrollStep.rows` is the delta handed to
 *   `ghostty_terminal_scroll_viewport` with tag `DELTA`. A **negative** delta
 *   moves the viewport back into history and a positive delta moves it forward
 *   toward the live bottom. That is not a guess: `ghosttyVtContract.test.ts`
 *   drives the pinned artifact and asserts that a negative delta lowers
 *   `SCROLLBAR.offset` (older content) while a positive delta raises it.
 *   Ghostty clamps at both ends, so an over-scroll is not an error.
 * - `ViewportScrollStep.offsetPx` is always in `[0, cellHeight)` and is how far
 *   *down* the painter shifts the grid, because scrolling back reveals older
 *   content above the viewport and pushes what was there downwards.
 *
 * At the live bottom the remainder is exactly `0`, so a terminal nobody has
 * scrolled paints exactly as it did before this module existed.
 *
 * ## Why the position is not purely relative
 *
 * A gesture is folded in relative to where the last one left off, but the
 * *position* is not the renderer's to remember alone: output arriving while the
 * reader is scrolled back moves the live bottom without moving the viewport, so
 * the same content is further back than it was a moment ago. `anchor` exists to
 * take Ghostty's own absolute count back before folding the next gesture in.
 * Without it the row count drifts by one per line of output, and a wheel-down
 * that this module reports as arriving at the bottom leaves the viewport short
 * of it — showing scrollback the reader cannot escape.
 */

/** `WheelEvent.deltaMode` values. `WheelEvent.DOM_DELTA_*` needs a DOM. */
export const WHEEL_DELTA_PIXEL = 0;
export const WHEEL_DELTA_LINE = 1;
export const WHEEL_DELTA_PAGE = 2;

export interface WheelScrollInput {
  /** Raw `WheelEvent.deltaY`: negative scrolls up, into history. */
  deltaY: number;
  /** Raw `WheelEvent.deltaMode`. */
  deltaMode: number;
  /** Height of one cell in CSS pixels. */
  cellHeight: number;
  /** Rows of history above the viewport — `SCROLLBAR.total - SCROLLBAR.len`. */
  scrollbackRows: number;
  /** Rows in the viewport; only a page-mode wheel needs it. */
  viewportRows: number;
}

export interface ViewportScrollStep {
  /** Whole rows to move the viewport by; negative moves back into history. */
  rows: number;
  /** Sub-row remainder, in `[0, cellHeight)`, for the painter to shift by. */
  offsetPx: number;
}

/**
 * The continuous scroll position of one terminal surface, in pixels back from
 * the live bottom.
 */
export class ViewportScrollAccumulator {
  /** Distance back from the live bottom in pixels; never negative. */
  private distancePx = 0;

  /** Whole rows the terminal's viewport has already been moved back by. */
  private rows = 0;

  /** Sub-row part of `distancePx`, restated in pixels for the painter. */
  private remainderPx = 0;

  /** How far down the painter should shift the grid, in CSS pixels. */
  get offsetPx(): number {
    return this.remainderPx;
  }

  /** Whole rows of history currently above the viewport's top edge. */
  get rowsBack(): number {
    return this.rows;
  }

  /** Whether this surface is at the live bottom, where the offset is zero. */
  get atBottom(): boolean {
    return this.distancePx === 0;
  }

  /**
   * Re-anchor to the terminal's own absolute position before folding the next
   * gesture in. `rowsBack` is how many rows of history sit between the
   * viewport's top edge and the live bottom, as Ghostty counts them:
   * `SCROLLBAR.total - SCROLLBAR.len - SCROLLBAR.offset`, which is zero exactly
   * when the viewport is pinned to the bottom.
   *
   * The sub-row remainder survives the re-anchor. Output arriving while the
   * reader is scrolled back does not move the content under the reader — only
   * the distance from it to the bottom — so the paint shift is still correct.
   */
  anchor(rowsBack: number, cellHeight: number): void {
    const rows = Math.max(0, Math.floor(rowsBack));
    if (rows === this.rows) return;
    this.rows = rows;
    this.distancePx = rows * Math.max(1, cellHeight) + this.remainderPx;
  }

  /** Forget the gesture. The caller is responsible for the viewport itself. */
  reset(): void {
    this.distancePx = 0;
    this.rows = 0;
    this.remainderPx = 0;
  }

  /**
   * Fold one wheel event into the position and report what changed. `rows` is
   * zero for a gesture that stayed inside the current row, which is what makes
   * sub-row scrolling free of terminal calls.
   */
  wheel(input: WheelScrollInput): ViewportScrollStep {
    const cellHeight = Math.max(1, input.cellHeight);
    const scrollbackRows = Math.max(0, Math.floor(input.scrollbackRows));
    this.distancePx = clamp(
      this.distancePx + backPixels(input, cellHeight),
      0,
      scrollbackRows * cellHeight,
    );
    // `distancePx` is already clamped to the available history, so the floor
    // cannot ask for a row that does not exist.
    const rowsBack = Math.floor(this.distancePx / cellHeight);
    // Only the change since the last event is applied to the viewport; the
    // position itself lives in `distancePx`.
    const rows = this.rows - rowsBack;
    this.rows = rowsBack;
    // The floor guarantees a non-negative remainder in exact arithmetic; the
    // clamp keeps a fractional cell height's rounding error from producing a
    // negative offset the painter would shift the wrong way.
    this.remainderPx = Math.max(0, this.distancePx - rowsBack * cellHeight);
    return { rows, offsetPx: this.remainderPx };
  }
}

/** Pixels of scroll-back one wheel event asks for. */
function backPixels(input: WheelScrollInput, cellHeight: number): number {
  if (!Number.isFinite(input.deltaY)) return 0;
  // Up is back: a negative `deltaY` is a positive scroll-back distance.
  const magnitude = -input.deltaY;
  if (input.deltaMode === WHEEL_DELTA_LINE) return magnitude * cellHeight;
  if (input.deltaMode === WHEEL_DELTA_PAGE) {
    return magnitude * Math.max(1, Math.floor(input.viewportRows)) * cellHeight;
  }
  return magnitude;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
