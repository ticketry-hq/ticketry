/**
 * CODING-1304 — encode wheel gestures with Ghostty's own mouse encoder.
 *
 * When the running program has asked for mouse reports, the faithful thing is
 * to send it a mouse report: the program then scrolls itself, exactly as it
 * would under any other terminal. The alternative the rest of Studio uses —
 * driving `tmux copy-mode` from the host — is a synthesized scroll that a
 * full-screen program never sees, so its own viewport never moves.
 *
 * Like the key encoder, this re-reads the tracking mode and report format from
 * the terminal on every gesture, so a program turning mouse reporting on or
 * off takes effect immediately and tmux's own `mouse` option stays off.
 */
import type { GhosttyVtRuntime } from "./wasmRuntime";
import { resolveGhosttyVtAbi, type GhosttyVtAbi } from "./abi";

const ENCODE_BUFFER_BYTES = 64;
/** wasm32 `size_t`; the manifest's `abi.usize_size` confirms it at load time. */
const USIZE_BYTES = 4;
const POSITION_BYTES = 8;

export interface WheelGesture {
  direction: "up" | "down";
  /** Pixel position of the pointer within the canvas. */
  x: number;
  y: number;
  mods: number;
}

export interface EncoderViewport {
  screenWidth: number;
  screenHeight: number;
  cellWidth: number;
  cellHeight: number;
}

/** A reusable Ghostty mouse encoder bound to one terminal. */
export class GhosttyMouseEncoder {
  private readonly runtime: GhosttyVtRuntime;
  private readonly abi: GhosttyVtAbi;
  private readonly encoder: number;
  private readonly event: number;
  private readonly outBuf: number;
  private readonly outLen: number;
  private readonly position: number;
  private readonly sizeStruct: number;
  private readonly sizeBytes: number;
  private readonly trackingOut: number;
  private readonly action: number;
  private readonly wheelUp: number;
  private readonly wheelDown: number;
  private readonly sizeOption: number;
  private readonly trackingNone: number;
  private disposed = false;

  constructor(runtime: GhosttyVtRuntime) {
    this.runtime = runtime;
    this.abi = resolveGhosttyVtAbi(runtime);
    const { exports } = runtime;
    this.encoder = allocate(runtime, "ghostty_mouse_encoder_new", (out) =>
      exports.ghostty_mouse_encoder_new(0, out),
    );
    this.event = allocate(runtime, "ghostty_mouse_event_new", (out) =>
      exports.ghostty_mouse_event_new(0, out),
    );
    this.outBuf = exports.ghostty_wasm_alloc(ENCODE_BUFFER_BYTES);
    this.outLen = exports.ghostty_wasm_alloc(USIZE_BYTES);
    this.position = exports.ghostty_wasm_alloc(POSITION_BYTES);
    this.trackingOut = exports.ghostty_wasm_alloc(USIZE_BYTES);
    this.sizeBytes = runtime.sizeOf("GhosttyMouseEncoderSize");
    this.sizeStruct = exports.ghostty_wasm_alloc(this.sizeBytes);
    // X10 numbers the wheel as buttons four and five; every later report
    // format keeps that numbering.
    this.action = runtime.enumValue("GhosttyMouseAction", "PRESS");
    this.wheelUp = runtime.enumValue("GhosttyMouseButton", "FOUR");
    this.wheelDown = runtime.enumValue("GhosttyMouseButton", "FIVE");
    this.sizeOption = runtime.enumValue("GhosttyMouseEncoderOption", "SIZE");
    this.trackingNone = runtime.enumValue("GhosttyMouseTrackingMode", "NONE");
  }

  /**
   * Whether the running program has mouse reporting on. When it has not, the
   * caller should fall back to the host's scrollback control instead: there is
   * nobody to receive a report.
   */
  tracking(terminal: number): boolean {
    if (this.disposed) throw new Error("ghostty-vt mouse encoder used after dispose");
    const view = this.runtime.view();
    view.setUint32(this.trackingOut, 0, true);
    const result = this.runtime.exports.ghostty_terminal_get(
      terminal,
      this.abi.terminalData.mouseTracking,
      this.trackingOut,
    );
    if (result !== this.abi.success) return false;
    return view.getInt32(this.trackingOut, true) !== this.trackingNone;
  }

  /** Tell the encoder the pixel geometry it converts positions against. */
  setViewport(viewport: EncoderViewport): void {
    if (this.disposed) throw new Error("ghostty-vt mouse encoder used after dispose");
    const view = this.runtime.view();
    this.runtime.bytes().fill(0, this.sizeStruct, this.sizeStruct + this.sizeBytes);
    const fields = this.runtime.fields("GhosttyMouseEncoderSize");
    // GHOSTTY_INIT_SIZED: the struct stamps its own size so a re-pinned
    // artifact that grew the struct still reads the fields it knows.
    view.setUint32(this.sizeStruct + fields.size.offset, this.sizeBytes, true);
    view.setUint32(this.sizeStruct + fields.screen_width.offset, viewport.screenWidth, true);
    view.setUint32(this.sizeStruct + fields.screen_height.offset, viewport.screenHeight, true);
    view.setUint32(this.sizeStruct + fields.cell_width.offset, viewport.cellWidth, true);
    view.setUint32(this.sizeStruct + fields.cell_height.offset, viewport.cellHeight, true);
    this.runtime.exports.ghostty_mouse_encoder_setopt(
      this.encoder,
      this.sizeOption,
      this.sizeStruct,
    );
  }

  /**
   * Encode one wheel notch, or return null when the current mode produces no
   * report.
   */
  encodeWheel(terminal: number, gesture: WheelGesture): Uint8Array | null {
    if (this.disposed) throw new Error("ghostty-vt mouse encoder used after dispose");
    const { exports } = this.runtime;
    const view = this.runtime.view();

    // The tracking mode and report format live on the terminal, so re-read
    // them rather than caching a mode the program may have just changed.
    exports.ghostty_mouse_encoder_setopt_from_terminal(this.encoder, terminal);
    exports.ghostty_mouse_event_set_action(this.event, this.action);
    exports.ghostty_mouse_event_set_button(
      this.event,
      gesture.direction === "up" ? this.wheelUp : this.wheelDown,
    );
    exports.ghostty_mouse_event_set_mods(this.event, gesture.mods);
    view.setFloat32(this.position, gesture.x, true);
    view.setFloat32(this.position + 4, gesture.y, true);
    exports.ghostty_mouse_event_set_position(this.event, this.position);

    view.setUint32(this.outLen, 0, true);
    const result = exports.ghostty_mouse_encoder_encode(
      this.encoder,
      this.event,
      this.outBuf,
      ENCODE_BUFFER_BYTES,
      this.outLen,
    );
    // A mode that reports nothing is an ordinary answer, not a fault.
    if (result !== this.abi.success) return null;
    const written = view.getUint32(this.outLen, true);
    if (written === 0) return null;
    return this.runtime.bytes().slice(this.outBuf, this.outBuf + written);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { exports } = this.runtime;
    exports.ghostty_mouse_event_free(this.event);
    exports.ghostty_mouse_encoder_free(this.encoder);
    exports.ghostty_wasm_free(this.outBuf, ENCODE_BUFFER_BYTES);
    exports.ghostty_wasm_free(this.outLen, USIZE_BYTES);
    exports.ghostty_wasm_free(this.position, POSITION_BYTES);
    exports.ghostty_wasm_free(this.trackingOut, USIZE_BYTES);
    exports.ghostty_wasm_free(this.sizeStruct, this.sizeBytes);
  }
}

function allocate(
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
