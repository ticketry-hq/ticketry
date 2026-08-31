/**
 * CODING-1304 — singleton libghostty-vt WebAssembly runtime.
 *
 * One compiled module and one instance per browser context, shared by every
 * `ghostty-wasm` terminal. Per-terminal state lives in Ghostty handles inside
 * this instance's linear memory, never in React.
 *
 * Struct offsets, struct sizes and enum values are read from the artifact's
 * own `ghostty_type_json()` ABI manifest rather than transcribed from headers,
 * so a re-pinned artifact cannot silently desynchronise this binding.
 */

/** Where the prepared artifact is served from. See `prepare-ghostty-vt-wasm.sh`. */
export const GHOSTTY_VT_ARTIFACT_URL = "/ghostty-vt/ghostty-vt.wasm";

export type GhosttyWasmLoadFailure =
  | "artifact_unavailable"
  | "instantiation_failed"
  | "manifest_unreadable";

export class GhosttyWasmLoadError extends Error {
  readonly failure: GhosttyWasmLoadFailure;

  /** The underlying fetch/compile error, kept for diagnostics. */
  readonly reason: unknown;

  constructor(failure: GhosttyWasmLoadFailure, message: string, reason?: unknown) {
    super(message);
    this.name = "GhosttyWasmLoadError";
    this.failure = failure;
    this.reason = reason;
  }
}

export class GhosttyVtError extends Error {
  readonly code: number;

  constructor(call: string, code: number) {
    super(`${call} failed with libghostty-vt result ${code}`);
    this.name = "GhosttyVtError";
    this.code = code;
  }
}

/** A struct field as described by the ABI manifest. */
export interface AbiField {
  offset: number;
  size: number;
  type: string;
  elem?: string;
  count?: number;
}

export interface AbiType {
  size?: number;
  alignment?: number;
  fields?: Record<string, AbiField>;
  values?: Record<string, number>;
}

export interface AbiManifest {
  schema: number;
  library_version: string;
  commit: string | null;
  abi: {
    target: string;
    pointer_size: number;
    usize_size: number;
    max_alignment: number;
    endian: "little" | "big";
  };
  types: Record<string, AbiType>;
}

/**
 * The subset of the C ABI this experiment calls. Everything is `number`
 * because every value crossing the boundary is a wasm32 pointer or integer.
 */
export interface GhosttyVtExports {
  memory: WebAssembly.Memory;
  ghostty_type_json(): number;

  ghostty_wasm_alloc_opaque(): number;
  ghostty_wasm_free_opaque(ptr: number): void;
  ghostty_wasm_alloc_u8_array(len: number): number;
  ghostty_wasm_free_u8_array(ptr: number, len: number): void;
  ghostty_wasm_alloc_u8(): number;
  ghostty_wasm_free_u8(ptr: number): void;
  ghostty_wasm_alloc_usize(): number;
  ghostty_wasm_free_usize(ptr: number): void;

  ghostty_terminal_new(allocator: number, out: number, cols: number, rows: number): number;
  ghostty_terminal_free(terminal: number): void;
  ghostty_terminal_resize(
    terminal: number,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ): number;
  ghostty_terminal_vt_write(terminal: number, ptr: number, len: number): void;
  ghostty_terminal_get(terminal: number, data: number, out: number): number;
  ghostty_terminal_set(terminal: number, option: number, value: number): number;
  ghostty_terminal_scroll_viewport(terminal: number, behaviorPtr: number): void;

  ghostty_render_state_new(allocator: number, out: number): number;
  ghostty_render_state_free(state: number): void;
  ghostty_render_state_update(state: number, terminal: number): number;
  ghostty_render_state_clean(state: number): number;
  ghostty_render_state_get(state: number, data: number, out: number): number;
  ghostty_render_state_row_iterator_new(allocator: number, out: number): number;
  ghostty_render_state_row_iterator_free(iterator: number): void;
  ghostty_render_state_row_iterator_next(iterator: number): number;
  ghostty_render_state_row_iterator_next_dirty(iterator: number, outY: number): number;
  ghostty_render_state_row_get(iterator: number, data: number, out: number): number;
  ghostty_render_state_row_cells_new(allocator: number, out: number): number;
  ghostty_render_state_row_cells_next(cells: number): number;
  ghostty_render_state_row_cells_get(cells: number, data: number, out: number): number;
  ghostty_render_state_row_cells_free(cells: number): void;

  ghostty_key_encoder_new(allocator: number, out: number): number;
  ghostty_key_encoder_free(encoder: number): void;
  ghostty_key_encoder_setopt_from_terminal(encoder: number, terminal: number): void;
  ghostty_key_encoder_encode(
    encoder: number,
    event: number,
    outBuf: number,
    outBufSize: number,
    outLen: number,
  ): number;
  ghostty_key_event_new(allocator: number, out: number): number;
  ghostty_key_event_free(event: number): void;
  ghostty_key_event_set_action(event: number, action: number): void;
  ghostty_key_event_set_key(event: number, key: number): void;
  ghostty_key_event_set_mods(event: number, mods: number): void;
  ghostty_key_event_set_consumed_mods(event: number, mods: number): void;
  ghostty_key_event_set_composing(event: number, composing: number): void;
  ghostty_key_event_set_utf8(event: number, ptr: number, len: number): void;
  ghostty_key_event_set_unshifted_codepoint(event: number, codepoint: number): void;
}

export interface GhosttyVtRuntime {
  readonly exports: GhosttyVtExports;
  readonly manifest: AbiManifest;
  /** A byte view over the *current* linear memory buffer (invalidated on growth). */
  bytes(): Uint8Array;
  /** A DataView over the *current* linear memory buffer (invalidated on growth). */
  view(): DataView;
  /** Struct field descriptors for one manifest type; throws when absent. */
  fields(type: string): Record<string, AbiField>;
  /** Byte size of one manifest type; throws when absent. */
  sizeOf(type: string): number;
  /** Numeric value of one enum member; throws when absent. */
  enumValue(type: string, member: string): number;
  /** Raise on any non-`SUCCESS` result code. */
  check(call: string, result: number): void;
}

let runtime: Promise<GhosttyVtRuntime> | null = null;

/**
 * Load the singleton runtime. Concurrent callers share one in-flight load; a
 * failed load is not cached, so a later retry can succeed after the artifact
 * is prepared.
 */
export function loadGhosttyVtRuntime(
  url: string = GHOSTTY_VT_ARTIFACT_URL,
): Promise<GhosttyVtRuntime> {
  runtime ??= instantiate(url).catch((error) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

/** Drop the cached runtime. Tests only. */
export function resetGhosttyVtRuntime(): void {
  runtime = null;
}

async function instantiate(url: string): Promise<GhosttyVtRuntime> {
  let artifact: ArrayBuffer;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    artifact = await response.arrayBuffer();
  } catch (error) {
    throw new GhosttyWasmLoadError(
      "artifact_unavailable",
      `ghostty-vt artifact could not be fetched from ${url}`,
      error,
    );
  }

  let instance: WebAssembly.Instance;
  try {
    const module = await WebAssembly.compile(artifact);
    // The freestanding artifact declares no imports; passing an empty import
    // object keeps an artifact that grows one from failing silently.
    instance = await WebAssembly.instantiate(module, {});
  } catch (error) {
    throw new GhosttyWasmLoadError(
      "instantiation_failed",
      "ghostty-vt artifact could not be instantiated",
      error,
    );
  }

  return buildRuntime(instance.exports as unknown as GhosttyVtExports);
}

/** Wrap already-instantiated exports. Shared by `instantiate` and tests. */
export function buildRuntime(exports: GhosttyVtExports): GhosttyVtRuntime {
  let cachedBuffer: ArrayBuffer | null = null;
  let cachedBytes: Uint8Array | null = null;
  let cachedView: DataView | null = null;

  function refresh(): void {
    const buffer = exports.memory.buffer;
    if (buffer === cachedBuffer) return;
    cachedBuffer = buffer;
    cachedBytes = new Uint8Array(buffer);
    cachedView = new DataView(buffer);
  }

  function bytes(): Uint8Array {
    refresh();
    return cachedBytes as Uint8Array;
  }

  function view(): DataView {
    refresh();
    return cachedView as DataView;
  }

  let manifest: AbiManifest;
  try {
    const ptr = exports.ghostty_type_json();
    const all = bytes();
    const end = all.indexOf(0, ptr);
    if (ptr === 0 || end === -1) throw new Error("manifest string is unterminated");
    manifest = JSON.parse(new TextDecoder().decode(all.subarray(ptr, end))) as AbiManifest;
  } catch (error) {
    throw new GhosttyWasmLoadError(
      "manifest_unreadable",
      "ghostty-vt ABI manifest could not be read",
      error,
    );
  }

  const success = manifest.types.GhosttyResult?.values?.SUCCESS ?? 0;

  return {
    exports,
    manifest,
    bytes,
    view,
    fields(type) {
      const fields = manifest.types[type]?.fields;
      if (!fields) throw new Error(`ghostty-vt manifest has no fields for ${type}`);
      return fields;
    },
    sizeOf(type) {
      const size = manifest.types[type]?.size;
      if (size === undefined) throw new Error(`ghostty-vt manifest has no size for ${type}`);
      return size;
    },
    enumValue(type, member) {
      const value = manifest.types[type]?.values?.[member];
      if (value === undefined) {
        throw new Error(`ghostty-vt manifest has no ${type}.${member}`);
      }
      return value;
    },
    check(call, result) {
      if (result !== success) throw new GhosttyVtError(call, result);
    },
  };
}
