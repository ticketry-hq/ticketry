/**
 * CODING-1304 — what a wheel gesture means to this renderer.
 *
 * Three answers, in precedence order:
 *
 * 1. A program that asked for mouse reports gets one, so it scrolls its own
 *    viewport exactly as it would under any other terminal. The alternative the
 *    rest of Studio uses — driving `tmux copy-mode` from the host — is a
 *    synthesized scroll a full-screen program never sees.
 * 2. Otherwise, on the primary screen the gesture is answered entirely locally.
 *    This renderer's wasm terminal already holds the scrollback the transport's
 *    bytes built, so scrolling it is one wasm call and no subprocess, the
 *    position is continuous rather than whole-line quantized, and tmux is not
 *    in the path at all.
 * 3. Only the alternate screen, which keeps no scrollback of its own, falls
 *    back to the durable viewer's tmux history. Sending cursor keys here turns
 *    Codex wheel gestures into ordinary TUI navigation input.
 *
 * tmux's own `mouse` option stays off in every case, so a renderer switch
 * leaves no trace on the session.
 *
 * The terminal calls here are the cheap ones — tracking mode, active screen,
 * scrollbar, viewport-live flag — so a gesture never builds a frame.
 *
 * ## Where the scroll position comes from
 *
 * Ghostty's scrollbar is the position of record; the pixel accumulator only
 * holds the sub-row part of the gesture and the row count it last agreed on.
 * Every gesture and every snap therefore consults the terminal before acting,
 * because output arriving while the reader is scrolled back moves the live
 * bottom without moving the viewport. Trusting the remembered row count instead
 * would leave the viewport short of the bottom while the accumulator reported
 * it had arrived, which closes every route back to the live output.
 */
import { ghosttyMods } from "./keyCodes";
import type { GhosttyMouseEncoder } from "./mouseEncoder";
import type { GhosttyVtTerminal } from "./terminalCore";
import { ViewportScrollAccumulator } from "./viewportScroll";

/** `WheelEvent.deltaMode` for line-wise wheels. */
const WHEEL_DELTA_LINE = 1;
const MAX_WHEEL_NOTCHES = 10;

export interface WheelPolicyOptions {
  core: GhosttyVtTerminal;
  mouse: GhosttyMouseEncoder;
  /** The canvas a gesture's pixel position is measured against. */
  canvas: HTMLCanvasElement;
  /** The current cell height in CSS pixels; it changes with the font. */
  cellHeight: () => number;
  /** The current viewport height in rows; it changes with the box. */
  viewportRows: () => number;
  /** Send bytes to the running program. */
  sendInput: (bytes: Uint8Array) => void;
  /** Scroll the durable tmux viewer when the active screen has no history. */
  scrollViewer: (direction: "up" | "down", lines: number) => void;
  /** Ask the surface for a paint. */
  scheduleFrame: () => void;
}

export class GhosttyWheelPolicy {
  private readonly options: WheelPolicyOptions;
  /** The continuous scroll position; whole rows of it live in the terminal. */
  private readonly position = new ViewportScrollAccumulator();

  constructor(options: WheelPolicyOptions) {
    this.options = options;
  }

  /** How far down the painter should shift the grid, in CSS pixels. */
  get offsetPx(): number {
    return this.position.offsetPx;
  }

  /**
   * Answer one gesture. Throws only when the terminal binding itself fails, so
   * the surface can fall back to xterm.
   */
  wheel(event: WheelEvent): void {
    const direction = event.deltaY < 0 ? "up" : "down";
    const notches = this.notches(event);
    if (this.sendMouseReports(event, direction, notches)) {
      // The program answers the report by redrawing its own viewport, so a
      // local scroll-back position would hide the very redraw the gesture asked
      // for — the same reason the alternate-screen branch below snaps. The snap
      // follows the send rather than preceding it so that a tracking mode which
      // produces no report at all still falls through with the reader's
      // position intact; both happen before the frame this schedules is painted.
      this.snapToBottom();
      return;
    }
    if (this.options.core.activeScreen() === "alternate") {
      // The alternate screen keeps no scrollback of its own, and taking it may
      // have left a stale local position behind.
      this.snapToBottom();
      this.options.scrollViewer(direction, notches);
      return;
    }
    this.scrollLocally(event);
  }

  /**
   * Return the viewport to the live bottom and clear the fractional offset with
   * it, so the grid lands back on exact row boundaries. Called when the reader
   * types, and on a resize, whose reflow makes a row-measured position
   * meaningless.
   */
  snapToBottom(): void {
    // Ghostty's answer, not the remembered row count. A position that has wound
    // back to zero is not proof the viewport is live: output that arrived while
    // the reader was scrolled back moved the bottom away from it.
    if (this.position.atBottom && this.options.core.viewportActive()) return;
    this.position.reset();
    this.options.core.scrollViewportToBottom();
    this.options.core.markDirty();
    this.options.scheduleFrame();
  }

  /**
   * Drop a position the running program has invalidated by moving the viewport
   * itself — taking the alternate screen, or scrolling in answer to a mouse
   * report. Ghostty reporting the viewport live again while whole rows of
   * scroll-back are still held is the signal. Called before each paint, and
   * free while nothing is scrolled back.
   */
  reconcile(): void {
    if (this.position.rowsBack === 0) return;
    if (!this.options.core.viewportActive()) return;
    this.position.reset();
    this.options.core.markDirty();
  }

  /** Fold the gesture into the local scroll position. */
  private scrollLocally(event: WheelEvent): void {
    const { core } = this.options;
    const bar = core.scrollbar();
    const cellHeight = this.options.cellHeight();
    const scrollbackRows = Math.max(0, bar.total - bar.len);
    // Take Ghostty's absolute position back before folding the gesture in. Its
    // viewport sits at row `bar.offset` of the history, so the rows between it
    // and the live bottom are `scrollbackRows - bar.offset` — zero exactly when
    // it is pinned to the bottom. Every line of output that arrived while the
    // reader was scrolled back grew that distance without the renderer moving
    // anything, which is precisely what a remembered row count cannot see.
    this.position.anchor(scrollbackRows - bar.offset, cellHeight);
    const before = this.position.offsetPx;
    const step = this.position.wheel({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      cellHeight,
      scrollbackRows,
      viewportRows: this.options.viewportRows(),
    });
    // A gesture that hit the end of the history moves nothing and paints
    // nothing.
    if (step.rows === 0 && step.offsetPx === before) return;
    if (this.position.atBottom) {
      // Arriving at the bottom is stated absolutely rather than as the delta
      // that happens to reach it, so the viewport is pinned live whenever the
      // position says it is — however much output moved the bottom meanwhile.
      core.scrollViewportToBottom();
    } else if (step.rows !== 0) {
      // A gesture that stayed inside one row is answered by the paint offset
      // alone, so it does not cross the wasm boundary at all.
      core.scrollViewportDelta(step.rows);
    }
    // Row damage does not describe a viewport move, and a fractional offset
    // shifts every row anyway, so the whole grid is repainted.
    core.markDirty();
    this.options.scheduleFrame();
  }

  /** One wheel notch per cell of travel, so a gesture moves what it covers. */
  private notches(event: WheelEvent): number {
    const lines =
      event.deltaMode === WHEEL_DELTA_LINE
        ? Math.abs(event.deltaY)
        : Math.abs(event.deltaY) / Math.max(1, this.options.cellHeight());
    return Math.min(MAX_WHEEL_NOTCHES, Math.max(1, Math.round(lines)));
  }

  /**
   * Report the gesture to a program that is tracking the mouse. Returns false
   * when nothing is tracking, or when the current mode produces no report.
   */
  private sendMouseReports(
    event: WheelEvent,
    direction: "up" | "down",
    notches: number,
  ): boolean {
    const { core, mouse } = this.options;
    const terminal = core.handle;
    if (!mouse.tracking(terminal)) return false;
    const box = this.options.canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let sent = false;
    for (let notch = 0; notch < notches; notch += 1) {
      const bytes = mouse.encodeWheel(terminal, { direction, x, y, mods: ghosttyMods(event) });
      if (!bytes) break;
      this.options.sendInput(bytes);
      sent = true;
    }
    return sent;
  }
}
