/**
 * CODING-1304 — one libghostty-vt terminal and the frames it produces.
 *
 * Owns Ghostty handles and the write scratch buffer. It does no drawing, no DOM
 * work and no React work: `frame()` returns plain data so the render loop never
 * touches component state.
 */
import { resolveGhosttyVtAbi, type GhosttyVtAbi } from "./abi";
import { FrameReader } from "./frameReader";
import type { Frame, FrameRow } from "./frameTypes";
import type { GhosttyVtRuntime } from "./wasmRuntime";

export type {
  Frame,
  FrameCell,
  FrameCursor,
  FrameCursorStyle,
  FrameRow,
} from "./frameTypes";

const SCRATCH_BYTES = 64 * 1024;

export interface GhosttyVtTerminalOptions {
  cols: number;
  rows: number;
}

/** A libghostty-vt terminal plus the render state used to snapshot it. */
export class GhosttyVtTerminal {
  private readonly runtime: GhosttyVtRuntime;
  private readonly abi: GhosttyVtAbi;
  private readonly reader: FrameReader;
  private readonly terminal: number;
  private readonly state: number;
  private readonly rowIterator: number;
  private readonly cells: number;
  private readonly scratch: number;
  private disposed = false;

  constructor(runtime: GhosttyVtRuntime, options: GhosttyVtTerminalOptions) {
    this.runtime = runtime;
    this.abi = resolveGhosttyVtAbi(runtime);
    const { exports } = runtime;

    this.terminal = takeOpaque(runtime, "ghostty_terminal_new", (out) =>
      exports.ghostty_terminal_new(0, out, options.cols, options.rows),
    );
    this.state = takeOpaque(runtime, "ghostty_render_state_new", (out) =>
      exports.ghostty_render_state_new(0, out),
    );
    this.rowIterator = takeOpaque(runtime, "ghostty_render_state_row_iterator_new", (out) =>
      exports.ghostty_render_state_row_iterator_new(0, out),
    );
    this.cells = takeOpaque(runtime, "ghostty_render_state_row_cells_new", (out) =>
      exports.ghostty_render_state_row_cells_new(0, out),
    );
    this.scratch = exports.ghostty_wasm_alloc_u8_array(SCRATCH_BYTES);
    this.reader = new FrameReader(runtime, this.abi);
  }

  /** The native handle, for callers that must configure the terminal directly. */
  get handle(): number {
    return this.terminal;
  }

  /** Feed raw PTY bytes through the VT parser. */
  write(bytes: Uint8Array): void {
    this.assertLive();
    const { exports } = this.runtime;
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = Math.min(SCRATCH_BYTES, bytes.length - offset);
      this.runtime.bytes().set(bytes.subarray(offset, offset + chunk), this.scratch);
      exports.ghostty_terminal_vt_write(this.terminal, this.scratch, chunk);
      offset += chunk;
    }
  }

  resize(cols: number, rows: number, cellWidthPx: number, cellHeightPx: number): void {
    this.assertLive();
    this.runtime.check(
      "ghostty_terminal_resize",
      this.runtime.exports.ghostty_terminal_resize(
        this.terminal,
        cols,
        rows,
        Math.max(1, Math.round(cellWidthPx)),
        Math.max(1, Math.round(cellHeightPx)),
      ),
    );
  }

  /**
   * Snapshot the terminal. Returns only the rows Ghostty marked dirty, so a
   * quiet terminal costs one update and no cell reads.
   */
  frame(): Frame {
    this.assertLive();
    const { exports } = this.runtime;
    const { abi, reader } = this;
    this.runtime.check(
      "ghostty_render_state_update",
      exports.ghostty_render_state_update(this.state, this.terminal),
    );

    const dirtyRaw = reader.readU32(this.state, abi.renderData.dirty);
    const dirty =
      dirtyRaw === abi.dirty.full ? "full" : dirtyRaw === abi.dirty.partial ? "partial" : "none";
    const cols = reader.readU16(this.state, abi.renderData.cols);
    const rows = reader.readU16(this.state, abi.renderData.rows);
    const colors = reader.readColors(this.state);
    const cursor = reader.readCursor(this.state);

    const dirtyRows: FrameRow[] = [];
    if (dirty !== "none") {
      this.runtime.check(
        "ghostty_render_state_get(ROW_ITERATOR)",
        exports.ghostty_render_state_get(this.state, abi.renderData.rowIterator, this.rowIterator),
      );
      while (exports.ghostty_render_state_row_iterator_next_dirty(this.rowIterator, reader.slot)) {
        const y = this.runtime.view().getUint16(reader.slot, true);
        this.runtime.check(
          "ghostty_render_state_row_get(CELLS)",
          exports.ghostty_render_state_row_get(this.rowIterator, abi.rowData.cells, this.cells),
        );
        dirtyRows.push({ y, cells: reader.readRowCells(this.cells, cols, colors) });
      }
    }

    return {
      cols,
      rows,
      dirty,
      background: colors.background,
      foreground: colors.foreground,
      cursor,
      dirtyRows,
    };
  }

  /** Mark the frame consumed so the next `frame()` reports only new damage. */
  clean(): void {
    this.assertLive();
    this.runtime.check(
      "ghostty_render_state_clean",
      this.runtime.exports.ghostty_render_state_clean(this.state),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { exports } = this.runtime;
    this.reader.dispose();
    exports.ghostty_render_state_row_cells_free(this.cells);
    exports.ghostty_render_state_row_iterator_free(this.rowIterator);
    exports.ghostty_render_state_free(this.state);
    exports.ghostty_terminal_free(this.terminal);
    exports.ghostty_wasm_free_u8_array(this.scratch, SCRATCH_BYTES);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("ghostty-vt terminal used after dispose");
  }
}

/** Call a `..._new(allocator, out)` constructor and read back the handle. */
function takeOpaque(
  runtime: GhosttyVtRuntime,
  call: string,
  construct: (out: number) => number,
): number {
  const { exports } = runtime;
  const out = exports.ghostty_wasm_alloc_opaque();
  try {
    runtime.check(call, construct(out));
    return runtime.view().getUint32(out, true);
  } finally {
    exports.ghostty_wasm_free_opaque(out);
  }
}
