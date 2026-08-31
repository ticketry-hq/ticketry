/**
 * CODING-1304 — move and read one libghostty-vt terminal's own viewport.
 *
 * A wasm terminal keeps its own scrollback: every byte the transport delivers
 * is already in this instance's history, so scrolling it is a local call rather
 * than a `tmux copy-mode` round trip. This module is the narrow binding for
 * that — moving the viewport, and reading the three facts the scroll policy
 * branches on: which screen is active, where the viewport sits in the history,
 * and whether it is still pinned to the live bottom.
 *
 * Struct offsets, struct sizes, scalar widths and enum values come from the
 * artifact's ABI manifest, never from transcribed header constants — including
 * the widths of the bare scalars `ghostty_terminal_get` writes, which the
 * manifest describes only indirectly. See `BOOL_WITNESS`.
 */
import { resolveGhosttyVtAbi, type GhosttyVtAbi } from "./abi";
import type { AbiField, GhosttyVtRuntime } from "./wasmRuntime";

/** Which of a terminal's two screens is on show. */
export type GhosttyActiveScreen = "primary" | "alternate";

/**
 * Ghostty's scrollbar model: a `len`-row viewport sitting at row `offset` of a
 * `total`-row history, so `total - len` is the history above the viewport.
 */
export interface GhosttyScrollbar {
  total: number;
  offset: number;
  len: number;
}

const BEHAVIOR = "GhosttyTerminalScrollViewport";
const BEHAVIOR_TAG = "GhosttyTerminalScrollViewportTag";
const BEHAVIOR_VALUE = "GhosttyTerminalScrollViewportValue";
const SCROLLBAR = "GhosttyTerminalScrollbar";
const SCREEN = "GhosttyTerminalScreen";

/**
 * Where the width of a C `bool` comes from.
 *
 * `ghostty_terminal_get(VIEWPORT_ACTIVE)` writes a bare `bool`, and the manifest
 * describes named types only — a primitive out-parameter has no entry of its
 * own. It does declare the type and width of every struct field that holds a
 * `bool`, so the width is read from one of those instead of transcribed here.
 * `GhosttyRenderStateCursor.visible` is the witness: the renderer already reads
 * it every frame, so an artifact that dropped or widened it would break the
 * frame reader in the same breath. `assertDeclaredType` makes the borrowing
 * explicit — if that field ever stops being a `bool`, construction throws
 * rather than reading a byte of something else.
 */
const BOOL_WITNESS = { type: "GhosttyRenderStateCursor", field: "visible" } as const;

export class GhosttyTerminalViewport {
  private readonly runtime: GhosttyVtRuntime;
  private readonly abi: GhosttyVtAbi;
  private readonly terminal: number;
  private readonly behavior: number;
  private readonly behaviorBytes: number;
  private readonly scrollbarSlot: number;
  private readonly scrollbarBytes: number;
  private readonly scalar: number;
  private readonly scalarBytes: number;
  /** Width of a `GhosttyTerminalScreen`, per the manifest. */
  private readonly screenBytes: number;
  /** Width of a C `bool`, per the manifest field named by `BOOL_WITNESS`. */
  private readonly boolBytes: number;
  /** The behaviour struct's discriminant, per the manifest. */
  private readonly tagField: AbiField;
  /** The behaviour payload, and the `DELTA` arm inside it, per the manifest. */
  private readonly valueField: AbiField;
  private readonly deltaArm: AbiField;
  private readonly tagDelta: number;
  private readonly tagBottom: number;
  private readonly screenAlternate: number;

  constructor(runtime: GhosttyVtRuntime, terminal: number) {
    this.runtime = runtime;
    this.abi = resolveGhosttyVtAbi(runtime);
    this.terminal = terminal;
    const { exports } = runtime;
    this.behaviorBytes = runtime.sizeOf(BEHAVIOR);
    this.behavior = exports.ghostty_wasm_alloc(this.behaviorBytes);
    this.scrollbarBytes = runtime.sizeOf(SCROLLBAR);
    this.scrollbarSlot = exports.ghostty_wasm_alloc(this.scrollbarBytes);
    this.screenBytes = runtime.sizeOf(SCREEN);
    this.boolBytes = assertDeclaredType(
      runtime,
      BOOL_WITNESS.type,
      BOOL_WITNESS.field,
      "bool",
    ).size;
    // One slot serves every scalar read, so it is as wide as the widest of them.
    this.scalarBytes = Math.max(this.screenBytes, this.boolBytes);
    this.scalar = exports.ghostty_wasm_alloc(this.scalarBytes);
    this.tagField = assertDeclaredType(runtime, BEHAVIOR, "tag", BEHAVIOR_TAG);
    this.valueField = assertDeclaredType(runtime, BEHAVIOR, "value", BEHAVIOR_VALUE);
    // The payload is a union, so this arm's offset is relative to the union
    // rather than to the struct that holds it.
    this.deltaArm = assertDeclaredType(runtime, BEHAVIOR_VALUE, "delta", "i32");
    this.tagDelta = runtime.enumValue(BEHAVIOR_TAG, "DELTA");
    this.tagBottom = runtime.enumValue(BEHAVIOR_TAG, "BOTTOM");
    this.screenAlternate = runtime.enumValue(SCREEN, "ALTERNATE");
  }

  /**
   * Move the viewport by whole rows. Negative moves back into scrollback and
   * positive moves forward toward the live bottom — the convention
   * `viewportScroll.ts` documents and `ghosttyVtContract.test.ts` proves.
   * Ghostty clamps at both ends, so an over-scroll is not an error.
   */
  scrollViewportDelta(rows: number): void {
    if (rows === 0) return;
    this.writeBehavior(this.tagDelta, Math.trunc(rows));
    this.runtime.exports.ghostty_terminal_scroll_viewport(this.terminal, this.behavior);
  }

  /** Pin the viewport back to the live bottom, wherever it had drifted to. */
  scrollViewportToBottom(): void {
    this.writeBehavior(this.tagBottom);
    this.runtime.exports.ghostty_terminal_scroll_viewport(this.terminal, this.behavior);
  }

  /**
   * The alternate screen has no scrollback of its own, so a wheel gesture there
   * is not the renderer's to answer.
   */
  activeScreen(): GhosttyActiveScreen {
    const screen = this.read("ACTIVE_SCREEN", this.abi.terminalData.activeScreen, this.screenBytes);
    return screen === this.screenAlternate ? "alternate" : "primary";
  }

  /** Where the viewport sits in the history, in rows. */
  scrollbar(): GhosttyScrollbar {
    this.runtime.bytes().fill(0, this.scrollbarSlot, this.scrollbarSlot + this.scrollbarBytes);
    this.runtime.check(
      "ghostty_terminal_get(SCROLLBAR)",
      this.runtime.exports.ghostty_terminal_get(
        this.terminal,
        this.abi.terminalData.scrollbar,
        this.scrollbarSlot,
      ),
    );
    const fields = this.runtime.fields(SCROLLBAR);
    const view = this.runtime.view();
    // The counts are `u64` in the ABI and thousands of rows in practice, so the
    // Number conversion is exact at any size a terminal reaches.
    const rows = (field: string): number =>
      Number(view.getBigUint64(this.scrollbarSlot + fields[field].offset, true));
    return { total: rows("total"), offset: rows("offset"), len: rows("len") };
  }

  /** Whether the viewport is still pinned to the live bottom. */
  viewportActive(): boolean {
    // Read exactly the bool's own width out of the zeroed slot, never a word
    // that would also cover whatever sits behind it.
    return this.read("VIEWPORT_ACTIVE", this.abi.terminalData.viewportActive, this.boolBytes) !== 0;
  }

  dispose(): void {
    const { exports } = this.runtime;
    exports.ghostty_wasm_free(this.behavior, this.behaviorBytes);
    exports.ghostty_wasm_free(this.scrollbarSlot, this.scrollbarBytes);
    exports.ghostty_wasm_free(this.scalar, this.scalarBytes);
  }

  /** Fill the tagged union `ghostty_terminal_scroll_viewport` reads. */
  private writeBehavior(tag: number, delta?: number): void {
    // Zero first: the arms that carry no payload must not read stale bytes.
    this.runtime.bytes().fill(0, this.behavior, this.behavior + this.behaviorBytes);
    const view = this.runtime.view();
    writeInt(view, this.behavior + this.tagField.offset, this.tagField.size, tag);
    if (delta === undefined) return;
    const at = this.behavior + this.valueField.offset + this.deltaArm.offset;
    writeInt(view, at, this.deltaArm.size, delta);
  }

  /** Read one scalar out-parameter of a manifest-declared width. */
  private read(label: string, data: number, size: number): number {
    this.runtime.bytes().fill(0, this.scalar, this.scalar + this.scalarBytes);
    this.runtime.check(
      `ghostty_terminal_get(${label})`,
      this.runtime.exports.ghostty_terminal_get(this.terminal, data, this.scalar),
    );
    return readInt(this.runtime.view(), this.scalar, size);
  }
}

/**
 * Look a field up and confirm the manifest still declares it the type this
 * binding reads it as, so a re-pinned artifact fails loudly rather than
 * reinterpreting bytes.
 */
function assertDeclaredType(
  runtime: GhosttyVtRuntime,
  type: string,
  field: string,
  declared: string,
): AbiField {
  const found = runtime.fields(type)[field];
  if (!found) throw new Error(`ghostty-vt manifest has no ${type}.${field}`);
  if (found.type !== declared) {
    throw new Error(`ghostty-vt ${type}.${field} is ${found.type}, expected ${declared}`);
  }
  return found;
}

/** Little-endian signed read of a manifest-declared width. */
function readInt(view: DataView, at: number, size: number): number {
  if (size === 1) return view.getInt8(at);
  if (size === 2) return view.getInt16(at, true);
  if (size === 4) return view.getInt32(at, true);
  if (size === 8) return Number(view.getBigInt64(at, true));
  throw new Error(`ghostty-vt scalar of ${size} bytes is not readable`);
}

/** Little-endian signed write of a manifest-declared width. */
function writeInt(view: DataView, at: number, size: number, value: number): void {
  if (size === 1) view.setInt8(at, value);
  else if (size === 2) view.setInt16(at, value, true);
  else if (size === 4) view.setInt32(at, value, true);
  else if (size === 8) view.setBigInt64(at, BigInt(value), true);
  else throw new Error(`ghostty-vt scalar of ${size} bytes is not writable`);
}
