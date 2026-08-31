/**
 * CODING-1304 — the wheel policy's precedence: a tracking program first, the
 * renderer's own viewport second, the durable tmux viewer only on the alternate
 * screen. Driven through stub terminal and encoder seams, so it asserts the
 * decision rather than the ABI — `ghosttyVtContract.test.ts` covers the ABI.
 */
import { describe, expect, it } from "vitest";

import type { GhosttyMouseEncoder } from "./mouseEncoder";
import type { GhosttyActiveScreen, GhosttyVtTerminal } from "./terminalCore";
import { GhosttyWheelPolicy } from "./wheelPolicy";

const CELL_HEIGHT = 20;
const VIEWPORT_ROWS = 24;

/**
 * Everything the policy did, and the terminal facts it read.
 *
 * The stub models Ghostty's viewport absolutely rather than returning a fixed
 * scrollbar, because that absolute position is what the policy now reads: it
 * moves with the deltas the policy issues, and output arriving while the reader
 * is scrolled back moves the live bottom away from a viewport that stays put.
 * A stub that could not do that would pass whatever the policy did.
 */
function surfaceStub(scrollbackRows = 100) {
  const state = {
    screen: "primary" as GhosttyActiveScreen,
    /** Rows of history between the viewport's top edge and the live bottom. */
    rowsBack: 0,
    /** Rows of history the terminal holds. */
    scrollbackRows,
    tracking: false,
    /** A tracking mode Ghostty's encoder produces no report for. */
    reportsNothing: false,
  };
  const recorder = {
    deltas: [] as number[],
    toBottom: 0,
    dirty: 0,
    frames: 0,
    input: [] as string[],
    viewer: [] as Array<{ direction: "up" | "down"; lines: number }>,
  };
  const core = {
    handle: 1,
    activeScreen: () => state.screen,
    viewportActive: () => state.rowsBack === 0,
    scrollbar: () => ({
      total: state.scrollbackRows + VIEWPORT_ROWS,
      offset: state.scrollbackRows - state.rowsBack,
      len: VIEWPORT_ROWS,
    }),
    scrollViewportDelta: (rows: number) => {
      recorder.deltas.push(rows);
      // A positive delta moves forward toward the bottom; Ghostty clamps both
      // ends rather than erroring.
      state.rowsBack = Math.min(state.scrollbackRows, Math.max(0, state.rowsBack - rows));
    },
    scrollViewportToBottom: () => {
      recorder.toBottom += 1;
      state.rowsBack = 0;
    },
    markDirty: () => {
      recorder.dirty += 1;
    },
  } as unknown as GhosttyVtTerminal;
  const mouse = {
    tracking: () => state.tracking,
    encodeWheel: () =>
      state.reportsNothing ? null : new TextEncoder().encode("report"),
  } as unknown as GhosttyMouseEncoder;
  return {
    recorder,
    policy: new GhosttyWheelPolicy({
      core,
      mouse,
      canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as HTMLCanvasElement,
      cellHeight: () => CELL_HEIGHT,
      viewportRows: () => VIEWPORT_ROWS,
      sendInput: (bytes) => recorder.input.push(new TextDecoder().decode(bytes)),
      scrollViewer: (direction, lines) => recorder.viewer.push({ direction, lines }),
      scheduleFrame: () => {
        recorder.frames += 1;
      },
    }),
    screen: (screen: GhosttyActiveScreen) => {
      state.screen = screen;
    },
    /**
     * Output arrives. A viewport pinned to the bottom follows it; a
     * scrolled-back one stays where it is, so the bottom moves away from it.
     */
    output: (lines: number) => {
      state.scrollbackRows += lines;
      if (state.rowsBack > 0) state.rowsBack += lines;
    },
    /**
     * The running program moved the viewport itself — what answering a mouse
     * report or taking the alternate screen does.
     */
    programPinnedViewport: () => {
      state.rowsBack = 0;
    },
    /** Whether Ghostty itself would report the viewport live. */
    live: () => state.rowsBack === 0,
    /** How far back Ghostty's own viewport sits, in rows. */
    rowsBack: () => state.rowsBack,
    tracking: (value: boolean) => {
      state.tracking = value;
    },
    reportsNothing: () => {
      state.reportsNothing = true;
    },
  };
}

function wheel(deltaY: number, deltaMode = 0): WheelEvent {
  return {
    deltaY,
    deltaMode,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  } as WheelEvent;
}

describe("ghostty-wasm wheel policy", () => {
  it("reports the gesture to a program that is tracking the mouse", () => {
    const surface = surfaceStub();
    surface.tracking(true);
    surface.policy.wheel(wheel(-60));
    expect(surface.recorder.input).toEqual(["report", "report", "report"]);
    expect(surface.recorder.deltas).toEqual([]);
    expect(surface.recorder.viewer).toEqual([]);
    expect(surface.policy.offsetPx).toBe(0);
  });

  it("scrolls its own viewport on the primary screen", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-30));
    expect(surface.recorder.deltas).toEqual([-1]);
    expect(surface.policy.offsetPx).toBe(10);
    expect(surface.recorder.dirty).toBe(1);
    expect(surface.recorder.frames).toBe(1);
    // The whole point: tmux is not in this path.
    expect(surface.recorder.viewer).toEqual([]);
    expect(surface.recorder.input).toEqual([]);
  });

  it("moves nothing but the paint offset for a sub-row gesture", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-6));
    expect(surface.recorder.deltas).toEqual([]);
    expect(surface.policy.offsetPx).toBe(6);
    expect(surface.recorder.frames).toBe(1);
  });

  it("paints nothing once the history runs out", () => {
    const surface = surfaceStub(2);
    surface.policy.wheel(wheel(-1000));
    expect(surface.recorder.deltas).toEqual([-2]);
    expect(surface.recorder.frames).toBe(1);
    surface.policy.wheel(wheel(-1000));
    expect(surface.recorder.deltas).toEqual([-2]);
    expect(surface.recorder.frames).toBe(1);
  });

  it("falls back to the durable viewer on the alternate screen", () => {
    const surface = surfaceStub();
    surface.screen("alternate");
    surface.policy.wheel(wheel(-40));
    expect(surface.recorder.viewer).toEqual([{ direction: "up", lines: 2 }]);
    expect(surface.recorder.deltas).toEqual([]);
  });

  it("drops a local scroll position when a program takes the alternate screen", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-30));
    expect(surface.policy.offsetPx).toBe(10);
    surface.screen("alternate");
    surface.policy.wheel(wheel(-20));
    expect(surface.policy.offsetPx).toBe(0);
    expect(surface.recorder.toBottom).toBe(1);
    expect(surface.recorder.viewer).toHaveLength(1);
  });

  it("snaps to the live bottom before reporting to a program that starts tracking", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-30));
    expect(surface.policy.offsetPx).toBe(10);
    // A primary-screen program enables tracking while the reader is scrolled
    // back. It redraws into the live viewport, so leaving the paint on a
    // scroll-back position would hide everything it draws.
    surface.tracking(true);
    surface.policy.wheel(wheel(-30));
    expect(surface.recorder.input).toEqual(["report", "report"]);
    expect(surface.policy.offsetPx).toBe(0);
    expect(surface.recorder.toBottom).toBe(1);
    expect(surface.live()).toBe(true);
  });

  it("keeps the reader's position when a tracking mode produces no report", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-30));
    surface.tracking(true);
    surface.reportsNothing();
    surface.policy.wheel(wheel(-20));
    // Nothing was reported, so the gesture is still the renderer's to answer
    // locally and the position it had must survive.
    expect(surface.recorder.input).toEqual([]);
    expect(surface.recorder.toBottom).toBe(0);
    expect(surface.policy.offsetPx).toBe(10);
    expect(surface.recorder.deltas).toEqual([-1, -1]);
  });

  it("moves by rows, not to the bottom, when output arrived while scrolled back", () => {
    const surface = surfaceStub(9);
    surface.policy.wheel(wheel(-3 * CELL_HEIGHT));
    expect(surface.rowsBack()).toBe(3);
    // Five lines of output. The viewport stays put, so the same content is now
    // eight rows back from a bottom that moved without the renderer's help.
    surface.output(5);
    expect(surface.rowsBack()).toBe(8);

    // Wheeling down by what the reader scrolled up covers three of those eight
    // rows. A position remembered relatively would have called this the bottom.
    surface.policy.wheel(wheel(3 * CELL_HEIGHT));
    expect(surface.recorder.deltas).toEqual([-3, 3]);
    expect(surface.rowsBack()).toBe(5);
    expect(surface.live()).toBe(false);

    // The five rows that remain still move. A position that had wound its own
    // counter to zero would have treated this gesture as an over-scroll and
    // answered nothing at all.
    surface.policy.wheel(wheel(2 * CELL_HEIGHT));
    expect(surface.recorder.deltas).toEqual([-3, 3, 2]);
    expect(surface.rowsBack()).toBe(3);
  });

  it("reaches the live bottom by pinning it, however far the bottom moved", () => {
    const surface = surfaceStub(9);
    surface.policy.wheel(wheel(-3 * CELL_HEIGHT));
    surface.output(5);
    // The remaining eight rows in one gesture: the policy states arrival at the
    // bottom absolutely rather than trusting a delta to land on it.
    surface.policy.wheel(wheel(8 * CELL_HEIGHT));
    expect(surface.recorder.toBottom).toBe(1);
    expect(surface.live()).toBe(true);
    expect(surface.policy.offsetPx).toBe(0);
  });

  it("snaps to the live bottom even when its own position believes it is there", () => {
    const surface = surfaceStub(9);
    surface.policy.wheel(wheel(-3 * CELL_HEIGHT));
    surface.output(5);
    surface.policy.wheel(wheel(3 * CELL_HEIGHT));
    // Whatever the accumulator thinks, a keystroke must land the reader on the
    // live output — this is the escape hatch that used to be shut.
    surface.policy.snapToBottom();
    expect(surface.recorder.toBottom).toBe(1);
    expect(surface.live()).toBe(true);
    expect(surface.policy.offsetPx).toBe(0);
  });

  it("snaps back to the live bottom, and only when it is scrolled back", () => {
    const surface = surfaceStub();
    // Nothing to do, and the terminal agrees the viewport is live, so the snap
    // costs one scalar read and no viewport call.
    surface.policy.snapToBottom();
    expect(surface.recorder.toBottom).toBe(0);
    surface.policy.wheel(wheel(-30));
    surface.policy.snapToBottom();
    expect(surface.recorder.toBottom).toBe(1);
    expect(surface.policy.offsetPx).toBe(0);
    expect(surface.live()).toBe(true);
    surface.policy.snapToBottom();
    expect(surface.recorder.toBottom).toBe(1);
  });

  it("drops a position the terminal has already left", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-30));
    // The viewport is where the policy put it, so the position still stands.
    surface.policy.reconcile();
    expect(surface.policy.offsetPx).toBe(10);
    // The program moved the viewport back to the bottom itself, so the held
    // rows are gone.
    surface.programPinnedViewport();
    surface.policy.reconcile();
    expect(surface.policy.offsetPx).toBe(0);
  });

  it("leaves a sub-row offset alone, since the viewport never moved for it", () => {
    const surface = surfaceStub();
    surface.policy.wheel(wheel(-6));
    surface.policy.reconcile();
    expect(surface.policy.offsetPx).toBe(6);
  });
});
