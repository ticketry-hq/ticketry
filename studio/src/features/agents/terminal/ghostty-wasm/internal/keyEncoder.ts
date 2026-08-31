/**
 * CODING-1304 — encode DOM key events with Ghostty's own key encoder.
 *
 * Using the library encoder rather than a hand-written key map is the point:
 * it keeps cursor-key mode, keypad mode, `modifyOtherKeys` and the Kitty
 * keyboard protocol consistent with what the native renderer sends, and it
 * re-reads those modes from the terminal on every keystroke.
 */
import { ghosttyKeyName, ghosttyMods, unshiftedCodepoint } from "./keyCodes";
import type { GhosttyVtRuntime } from "./wasmRuntime";
import { resolveGhosttyVtAbi, type GhosttyVtAbi } from "./abi";

const ENCODE_BUFFER_BYTES = 128;
const UTF8_BUFFER_BYTES = 32;

export interface EncodableKeyEvent {
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  getModifierState?: (key: string) => boolean;
}

/** A reusable Ghostty key encoder bound to one terminal. */
export class GhosttyKeyEncoder {
  private readonly runtime: GhosttyVtRuntime;
  private readonly abi: GhosttyVtAbi;
  private readonly encoder: number;
  private readonly event: number;
  private readonly outBuf: number;
  private readonly outLen: number;
  private readonly utf8Buf: number;
  private disposed = false;

  constructor(runtime: GhosttyVtRuntime) {
    this.runtime = runtime;
    this.abi = resolveGhosttyVtAbi(runtime);
    const { exports } = runtime;
    this.encoder = allocate(runtime, "ghostty_key_encoder_new", (out) =>
      exports.ghostty_key_encoder_new(0, out),
    );
    this.event = allocate(runtime, "ghostty_key_event_new", (out) =>
      exports.ghostty_key_event_new(0, out),
    );
    this.outBuf = exports.ghostty_wasm_alloc_u8_array(ENCODE_BUFFER_BYTES);
    this.outLen = exports.ghostty_wasm_alloc_usize();
    this.utf8Buf = exports.ghostty_wasm_alloc_u8_array(UTF8_BUFFER_BYTES);
  }

  /**
   * Encode one key press for `terminal`, or return null when the key produces
   * nothing (a bare modifier, or a key the current mode swallows).
   */
  encode(terminal: number, event: EncodableKeyEvent): Uint8Array | null {
    if (this.disposed) throw new Error("ghostty-vt key encoder used after dispose");
    const { exports } = this.runtime;
    const keyName = ghosttyKeyName(event.code);
    let key: number;
    try {
      key = this.runtime.enumValue("GhosttyKey", keyName);
    } catch {
      key = this.runtime.enumValue("GhosttyKey", "UNIDENTIFIED");
    }

    exports.ghostty_key_encoder_setopt_from_terminal(this.encoder, terminal);
    exports.ghostty_key_event_set_action(
      this.event,
      event.repeat ? this.abi.keyAction.repeat : this.abi.keyAction.press,
    );
    exports.ghostty_key_event_set_key(this.event, key);
    exports.ghostty_key_event_set_mods(this.event, ghosttyMods(event));
    exports.ghostty_key_event_set_consumed_mods(this.event, 0);
    exports.ghostty_key_event_set_composing(this.event, event.isComposing ? 1 : 0);
    exports.ghostty_key_event_set_unshifted_codepoint(
      this.event,
      unshiftedCodepoint(event.code),
    );

    const utf8 = printableUtf8(event.key);
    if (utf8 && utf8.length <= UTF8_BUFFER_BYTES) {
      this.runtime.bytes().set(utf8, this.utf8Buf);
      exports.ghostty_key_event_set_utf8(this.event, this.utf8Buf, utf8.length);
    } else {
      exports.ghostty_key_event_set_utf8(this.event, this.utf8Buf, 0);
    }

    this.runtime.view().setUint32(this.outLen, 0, true);
    this.runtime.check(
      "ghostty_key_encoder_encode",
      exports.ghostty_key_encoder_encode(
        this.encoder,
        this.event,
        this.outBuf,
        ENCODE_BUFFER_BYTES,
        this.outLen,
      ),
    );
    const written = this.runtime.view().getUint32(this.outLen, true);
    if (written === 0) return null;
    return this.runtime.bytes().slice(this.outBuf, this.outBuf + written);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { exports } = this.runtime;
    exports.ghostty_key_event_free(this.event);
    exports.ghostty_key_encoder_free(this.encoder);
    exports.ghostty_wasm_free_u8_array(this.outBuf, ENCODE_BUFFER_BYTES);
    exports.ghostty_wasm_free_u8_array(this.utf8Buf, UTF8_BUFFER_BYTES);
    exports.ghostty_wasm_free_usize(this.outLen);
  }
}

const encoder = new TextEncoder();

/** `KeyboardEvent.key` is a name like "ArrowLeft" for non-printable keys. */
function printableUtf8(key: string): Uint8Array | null {
  if (!key || key.length > 8) return null;
  if (Array.from(key).length !== 1) return null;
  return encoder.encode(key);
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
