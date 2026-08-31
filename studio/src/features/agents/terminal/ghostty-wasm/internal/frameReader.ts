/**
 * CODING-1304 — read Ghostty render state out of wasm linear memory.
 *
 * Every struct read goes through one reusable output slot whose `size` field is
 * stamped for `GHOSTTY_INIT_SIZED` structs, and every offset comes from the
 * artifact's ABI manifest. Memory can grow under any call, so views are
 * re-fetched rather than cached across calls.
 */
import type { GhosttyVtAbi } from "./abi";
import type { FrameCell, FrameColors, FrameCursor, FrameCursorStyle } from "./frameTypes";
import type { GhosttyVtRuntime } from "./wasmRuntime";

/** A cluster wider than this is truncated rather than grown per cell. */
const MAX_GRAPHEME_CODEPOINTS = 32;

export class FrameReader {
  private readonly runtime: GhosttyVtRuntime;
  private readonly abi: GhosttyVtAbi;
  private readonly ptr: number;
  private readonly len: number;

  constructor(runtime: GhosttyVtRuntime, abi: GhosttyVtAbi) {
    this.runtime = runtime;
    this.abi = abi;
    this.len = Math.max(
      runtime.sizeOf("GhosttyRenderStateColors"),
      runtime.sizeOf("GhosttyRenderStateCursor"),
      runtime.sizeOf("GhosttyStyle"),
      runtime.sizeOf("GhosttyRenderStateRowSelection"),
      MAX_GRAPHEME_CODEPOINTS * 4,
    );
    this.ptr = runtime.exports.ghostty_wasm_alloc(this.len);
  }

  /** The scratch pointer, for callers that pass it as a plain out-parameter. */
  get slot(): number {
    return this.ptr;
  }

  dispose(): void {
    this.runtime.exports.ghostty_wasm_free(this.ptr, this.len);
  }

  readU32(state: number, key: number): number {
    this.zero();
    this.runtime.check(
      "ghostty_render_state_get",
      this.runtime.exports.ghostty_render_state_get(state, key, this.ptr),
    );
    return this.runtime.view().getUint32(this.ptr, true);
  }

  readU16(state: number, key: number): number {
    this.zero();
    this.runtime.check(
      "ghostty_render_state_get",
      this.runtime.exports.ghostty_render_state_get(state, key, this.ptr),
    );
    return this.runtime.view().getUint16(this.ptr, true);
  }

  readColors(state: number): FrameColors {
    const fields = this.runtime.fields("GhosttyRenderStateColors");
    this.prepareSized("GhosttyRenderStateColors");
    this.runtime.check(
      "ghostty_render_state_get(COLORS)",
      this.runtime.exports.ghostty_render_state_get(state, this.abi.renderData.colors, this.ptr),
    );
    return {
      background: this.readRgb(this.ptr + fields.background.offset),
      foreground: this.readRgb(this.ptr + fields.foreground.offset),
    };
  }

  readCursor(state: number): FrameCursor | null {
    const fields = this.runtime.fields("GhosttyRenderStateCursor");
    this.prepareSized("GhosttyRenderStateCursor");
    const result = this.runtime.exports.ghostty_render_state_get(
      state,
      this.abi.renderData.cursor,
      this.ptr,
    );
    // A terminal with no drawable cursor reports its absence, not an error.
    if (result !== this.abi.success) return null;
    const view = this.runtime.view();
    const visible = view.getUint8(this.ptr + fields.visible.offset) !== 0;
    const hasViewport = view.getUint8(this.ptr + fields.viewport_has_value.offset) !== 0;
    if (!visible || !hasViewport) return null;
    return {
      visible,
      blinking: view.getUint8(this.ptr + fields.blinking.offset) !== 0,
      x: view.getUint16(this.ptr + fields.viewport_x.offset, true),
      y: view.getUint16(this.ptr + fields.viewport_y.offset, true),
      style: this.cursorStyle(view.getUint32(this.ptr + fields.visual_style.offset, true)),
    };
  }

  /** Read one row's cells, stopping at `cols`. */
  readRowCells(cells: number, cols: number, colors: FrameColors): FrameCell[] {
    const { exports } = this.runtime;
    const { cellData } = this.abi;
    const out: FrameCell[] = [];

    while (exports.ghostty_render_state_row_cells_next(cells) && out.length < cols) {
      this.zero();
      exports.ghostty_render_state_row_cells_get(cells, cellData.graphemesLen, this.ptr);
      const graphemeLen = this.runtime.view().getUint32(this.ptr, true);

      const style = this.readStyle(cells);
      const selected = this.readCellBool(cells, cellData.selected);
      let fg = this.readCellRgb(cells, cellData.fgColor, colors.foreground);
      let bg = this.readCellRgb(cells, cellData.bgColor, colors.background);
      // Ghostty reports `inverse` as an attribute and leaves the swap to the
      // renderer: a cell styled `[7;31m` comes back with red *foreground* and
      // no background, and must paint as red-on-default. Resolving colours
      // without this leaves inverse text invisible.
      if (style.inverse) [fg, bg] = [bg, fg];

      out.push({
        text: graphemeLen === 0 ? "" : this.readGrapheme(cells, graphemeLen),
        fg,
        bg,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        selected,
      });
    }
    return out;
  }

  /** Read a cell's text attributes in one pass over the shared slot. */
  private readStyle(cells: number): {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    inverse: boolean;
  } {
    const fields = this.runtime.fields("GhosttyStyle");
    this.prepareSized("GhosttyStyle");
    const result = this.runtime.exports.ghostty_render_state_row_cells_get(
      cells,
      this.abi.cellData.style,
      this.ptr,
    );
    if (result !== this.abi.success) {
      return {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
      };
    }
    const view = this.runtime.view();
    return {
      bold: view.getUint8(this.ptr + fields.bold.offset) !== 0,
      italic: view.getUint8(this.ptr + fields.italic.offset) !== 0,
      underline: view.getInt32(this.ptr + fields.underline.offset, true) !== 0,
      strikethrough: view.getUint8(this.ptr + fields.strikethrough.offset) !== 0,
      inverse: view.getUint8(this.ptr + fields.inverse.offset) !== 0,
    };
  }

  /**
   * Read a cell's grapheme cluster as codepoints.
   *
   * `GRAPHEMES_BUF` writes into the caller's buffer, so the slot doubles as the
   * codepoint array. (`GRAPHEMES_UTF8` is an in/out that wants its own
   * pre-sized string buffer and returns OUT_OF_SPACE otherwise; codepoints are
   * the simpler contract for a Canvas that draws a cluster at a time.)
   */
  private readGrapheme(cells: number, graphemeLen: number): string {
    const wanted = Math.min(graphemeLen, MAX_GRAPHEME_CODEPOINTS);
    if (wanted === 0) return "";
    this.zero();
    const result = this.runtime.exports.ghostty_render_state_row_cells_get(
      cells,
      this.abi.cellData.graphemesBuf,
      this.ptr,
    );
    if (result !== this.abi.success) return "";
    const view = this.runtime.view();
    const codepoints: number[] = [];
    for (let index = 0; index < wanted; index += 1) {
      codepoints.push(view.getUint32(this.ptr + index * 4, true));
    }
    return String.fromCodePoint(...codepoints);
  }

  private cursorStyle(raw: number): FrameCursorStyle {
    const { cursorStyle } = this.abi;
    if (raw === cursorStyle.bar) return "bar";
    if (raw === cursorStyle.underline) return "underline";
    if (raw === cursorStyle.blockHollow) return "block_hollow";
    return "block";
  }

  /**
   * Per-cell colour is only present when the cell carries one. Ghostty reports
   * its absence with a non-success result (INVALID_VALUE for an unstyled cell,
   * not NO_VALUE), so any failure means "inherit the frame default" rather than
   * "read zeros" — which would paint every unstyled cell black.
   */
  private readCellRgb(cells: number, key: number, fallback: string): string {
    this.zero();
    const result = this.runtime.exports.ghostty_render_state_row_cells_get(cells, key, this.ptr);
    if (result !== this.abi.success) return fallback;
    return this.readRgb(this.ptr);
  }

  private readCellBool(cells: number, key: number): boolean {
    this.zero();
    const result = this.runtime.exports.ghostty_render_state_row_cells_get(cells, key, this.ptr);
    if (result !== this.abi.success) return false;
    return this.runtime.view().getUint8(this.ptr) !== 0;
  }

  private readRgb(ptr: number): string {
    const view = this.runtime.view();
    return `#${hex(view.getUint8(ptr))}${hex(view.getUint8(ptr + 1))}${hex(view.getUint8(ptr + 2))}`;
  }

  /** Zero the slot and stamp `size` for a `GHOSTTY_INIT_SIZED` struct. */
  private prepareSized(type: string): void {
    this.zero();
    this.runtime.view().setUint32(this.ptr, this.runtime.sizeOf(type), true);
  }

  private zero(): void {
    this.runtime.bytes().fill(0, this.ptr, this.ptr + this.len);
  }
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}
