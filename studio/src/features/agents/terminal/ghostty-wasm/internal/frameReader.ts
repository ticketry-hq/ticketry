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
      runtime.sizeOf("GhosttyString"),
      64,
    );
    this.ptr = runtime.exports.ghostty_wasm_alloc_u8_array(this.len);
  }

  /** The scratch pointer, for callers that pass it as a plain out-parameter. */
  get slot(): number {
    return this.ptr;
  }

  dispose(): void {
    this.runtime.exports.ghostty_wasm_free_u8_array(this.ptr, this.len);
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
    if (result === this.abi.noValue) return null;
    this.runtime.check("ghostty_render_state_get(CURSOR)", result);
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
    const styleFields = this.runtime.fields("GhosttyStyle");
    const stringFields = this.runtime.fields("GhosttyString");
    const out: FrameCell[] = [];

    while (exports.ghostty_render_state_row_cells_next(cells) && out.length < cols) {
      this.zero();
      exports.ghostty_render_state_row_cells_get(cells, cellData.graphemesLen, this.ptr);
      const graphemeLen = this.runtime.view().getUint32(this.ptr, true);
      const bg = this.readCellRgb(cells, cellData.bgColor, colors.background);
      const selected = this.readCellBool(cells, cellData.selected);

      if (graphemeLen === 0) {
        out.push({
          text: "",
          fg: colors.foreground,
          bg,
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          selected,
        });
        continue;
      }

      this.zero();
      exports.ghostty_render_state_row_cells_get(cells, cellData.graphemesUtf8, this.ptr);
      const view = this.runtime.view();
      const textPtr = view.getUint32(this.ptr + stringFields.ptr.offset, true);
      const textLen = view.getUint32(this.ptr + stringFields.len.offset, true);
      const text = textLen
        ? new TextDecoder().decode(this.runtime.bytes().subarray(textPtr, textPtr + textLen))
        : "";
      const fg = this.readCellRgb(cells, cellData.fgColor, colors.foreground);

      this.prepareSized("GhosttyStyle");
      exports.ghostty_render_state_row_cells_get(cells, cellData.style, this.ptr);
      const styleView = this.runtime.view();
      out.push({
        text,
        fg,
        bg,
        bold: styleView.getUint8(this.ptr + styleFields.bold.offset) !== 0,
        italic: styleView.getUint8(this.ptr + styleFields.italic.offset) !== 0,
        underline: styleView.getInt32(this.ptr + styleFields.underline.offset, true) !== 0,
        strikethrough: styleView.getUint8(this.ptr + styleFields.strikethrough.offset) !== 0,
        selected,
      });
    }
    return out;
  }

  private cursorStyle(raw: number): FrameCursorStyle {
    const { cursorStyle } = this.abi;
    if (raw === cursorStyle.bar) return "bar";
    if (raw === cursorStyle.underline) return "underline";
    if (raw === cursorStyle.blockHollow) return "block_hollow";
    return "block";
  }

  private readCellRgb(cells: number, key: number, fallback: string): string {
    this.zero();
    const result = this.runtime.exports.ghostty_render_state_row_cells_get(cells, key, this.ptr);
    if (result === this.abi.noValue) return fallback;
    return this.readRgb(this.ptr);
  }

  private readCellBool(cells: number, key: number): boolean {
    this.zero();
    const result = this.runtime.exports.ghostty_render_state_row_cells_get(cells, key, this.ptr);
    if (result === this.abi.noValue) return false;
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
