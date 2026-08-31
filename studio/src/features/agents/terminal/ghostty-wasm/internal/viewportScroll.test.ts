/**
 * CODING-1304 — the scroll accumulator's contract. Direction is the whole
 * point of this module, so every case names which way it expects to go.
 */
import { describe, expect, it } from "vitest";

import {
  ViewportScrollAccumulator,
  WHEEL_DELTA_LINE,
  WHEEL_DELTA_PAGE,
  WHEEL_DELTA_PIXEL,
  type WheelScrollInput,
} from "./viewportScroll";

const CELL_HEIGHT = 20;

function wheel(overrides: Partial<WheelScrollInput> = {}): WheelScrollInput {
  return {
    deltaY: 0,
    deltaMode: WHEEL_DELTA_PIXEL,
    cellHeight: CELL_HEIGHT,
    scrollbackRows: 100,
    viewportRows: 24,
    ...overrides,
  };
}

describe("viewport scroll accumulator", () => {
  it("starts at the live bottom with no offset", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(accumulator.atBottom).toBe(true);
    expect(accumulator.offsetPx).toBe(0);
    expect(accumulator.rowsBack).toBe(0);
  });

  it("turns a sub-row scroll up into a fractional offset and no viewport move", () => {
    const accumulator = new ViewportScrollAccumulator();
    const step = accumulator.wheel(wheel({ deltaY: -7 }));
    expect(step).toEqual({ rows: 0, offsetPx: 7 });
    expect(accumulator.atBottom).toBe(false);
    expect(accumulator.rowsBack).toBe(0);
  });

  it("moves the viewport back by whole rows once a row has accumulated", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(accumulator.wheel(wheel({ deltaY: -15 }))).toEqual({ rows: 0, offsetPx: 15 });
    // 15 + 12 = 27 px back: one whole row plus a 7 px remainder.
    expect(accumulator.wheel(wheel({ deltaY: -12 }))).toEqual({ rows: -1, offsetPx: 7 });
    expect(accumulator.rowsBack).toBe(1);
  });

  it("reports each event's change, not the accumulated position", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(accumulator.wheel(wheel({ deltaY: -60 }))).toEqual({ rows: -3, offsetPx: 0 });
    expect(accumulator.wheel(wheel({ deltaY: -40 }))).toEqual({ rows: -2, offsetPx: 0 });
    expect(accumulator.rowsBack).toBe(5);
  });

  it("moves the viewport forward again when scrolling down", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -50 }));
    // Back 50 px, forward 30 px: 20 px back, so one row forward and no
    // remainder.
    expect(accumulator.wheel(wheel({ deltaY: 30 }))).toEqual({ rows: 1, offsetPx: 0 });
    expect(accumulator.rowsBack).toBe(1);
  });

  it("returns to an exact zero offset at the bottom", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -33 }));
    expect(accumulator.wheel(wheel({ deltaY: 33 }))).toEqual({ rows: 1, offsetPx: 0 });
    expect(accumulator.atBottom).toBe(true);
    expect(accumulator.offsetPx).toBe(0);
  });

  it("cannot be scrolled past the bottom", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(accumulator.wheel(wheel({ deltaY: 500 }))).toEqual({ rows: 0, offsetPx: 0 });
    expect(accumulator.atBottom).toBe(true);
  });

  it("clamps to the history the terminal actually has", () => {
    const accumulator = new ViewportScrollAccumulator();
    const step = accumulator.wheel(wheel({ deltaY: -1000, scrollbackRows: 3 }));
    expect(step).toEqual({ rows: -3, offsetPx: 0 });
    // Already at the top: a further scroll up moves nothing.
    expect(accumulator.wheel(wheel({ deltaY: -1000, scrollbackRows: 3 }))).toEqual({
      rows: 0,
      offsetPx: 0,
    });
  });

  it("does not scroll at all when there is no history", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(accumulator.wheel(wheel({ deltaY: -200, scrollbackRows: 0 }))).toEqual({
      rows: 0,
      offsetPx: 0,
    });
    expect(accumulator.atBottom).toBe(true);
  });

  it("gives back rows when the history it was clamped to shrinks", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -200, scrollbackRows: 10 }));
    expect(accumulator.rowsBack).toBe(10);
    expect(accumulator.wheel(wheel({ deltaY: 0, scrollbackRows: 4 }))).toEqual({
      rows: 6,
      offsetPx: 0,
    });
    expect(accumulator.rowsBack).toBe(4);
  });

  it("re-anchors when the scrollback grows under a scrolled-back position", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -3 * CELL_HEIGHT, scrollbackRows: 9 }));
    expect(accumulator.rowsBack).toBe(3);

    // Five lines of output arrive. The viewport did not move, so the terminal
    // now counts the same content eight rows back from a bottom that moved.
    accumulator.anchor(8, CELL_HEIGHT);
    expect(accumulator.rowsBack).toBe(8);
    expect(accumulator.atBottom).toBe(false);

    // Scrolling down by three rows covers three of the eight. Without the
    // re-anchor this would have reported arrival at the bottom instead.
    expect(
      accumulator.wheel(wheel({ deltaY: 3 * CELL_HEIGHT, scrollbackRows: 14 })),
    ).toEqual({ rows: 3, offsetPx: 0 });
    expect(accumulator.rowsBack).toBe(5);
    expect(accumulator.atBottom).toBe(false);

    // And the remaining five still move, ending exactly at the live bottom.
    expect(
      accumulator.wheel(wheel({ deltaY: 5 * CELL_HEIGHT, scrollbackRows: 14 })),
    ).toEqual({ rows: 5, offsetPx: 0 });
    expect(accumulator.atBottom).toBe(true);
  });

  it("keeps the sub-row offset across a re-anchor", () => {
    const accumulator = new ViewportScrollAccumulator();
    // One row and a half back: the half is a paint shift, not a viewport move.
    accumulator.wheel(wheel({ deltaY: -30 }));
    expect(accumulator.offsetPx).toBe(10);
    // Output moved the bottom, not the content the reader is looking at, so the
    // shift is still correct and only the row count changes.
    accumulator.anchor(6, CELL_HEIGHT);
    expect(accumulator.rowsBack).toBe(6);
    expect(accumulator.offsetPx).toBe(10);
    expect(accumulator.wheel(wheel({ deltaY: 10 }))).toEqual({ rows: 0, offsetPx: 0 });
    expect(accumulator.rowsBack).toBe(6);
  });

  it("treats an anchor at the live bottom as the bottom", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -3 * CELL_HEIGHT }));
    expect(accumulator.atBottom).toBe(false);
    // The program pinned the viewport itself, so there is nothing held back.
    accumulator.anchor(0, CELL_HEIGHT);
    expect(accumulator.rowsBack).toBe(0);
    expect(accumulator.atBottom).toBe(true);
  });

  it("reads a line-mode wheel in cells", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(
      accumulator.wheel(wheel({ deltaY: -2, deltaMode: WHEEL_DELTA_LINE })),
    ).toEqual({ rows: -2, offsetPx: 0 });
  });

  it("reads a page-mode wheel in viewports", () => {
    const accumulator = new ViewportScrollAccumulator();
    expect(
      accumulator.wheel(wheel({ deltaY: -1, deltaMode: WHEEL_DELTA_PAGE, viewportRows: 24 })),
    ).toEqual({ rows: -24, offsetPx: 0 });
  });

  it("keeps the offset inside one cell for any fractional cell height", () => {
    const accumulator = new ViewportScrollAccumulator();
    const cellHeight = 17.5;
    for (let event = 0; event < 20; event += 1) {
      const step = accumulator.wheel(wheel({ deltaY: -6.3, cellHeight }));
      expect(step.offsetPx).toBeGreaterThanOrEqual(0);
      expect(step.offsetPx).toBeLessThan(cellHeight);
    }
  });

  it("ignores a non-finite delta rather than losing the position", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -25 }));
    expect(accumulator.wheel(wheel({ deltaY: Number.NaN }))).toEqual({ rows: 0, offsetPx: 5 });
    expect(accumulator.rowsBack).toBe(1);
  });

  it("resets to the bottom", () => {
    const accumulator = new ViewportScrollAccumulator();
    accumulator.wheel(wheel({ deltaY: -125 }));
    accumulator.reset();
    expect(accumulator.atBottom).toBe(true);
    expect(accumulator.offsetPx).toBe(0);
    expect(accumulator.rowsBack).toBe(0);
    // The next gesture starts from the bottom, not from where it left off.
    expect(accumulator.wheel(wheel({ deltaY: -20 }))).toEqual({ rows: -1, offsetPx: 0 });
  });
});
