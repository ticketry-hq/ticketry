/**
 * CODING-1304 — one `ghostty-wasm` terminal surface.
 *
 * Joins Ticketry's existing viewer transport to a libghostty-vt instance and a
 * Canvas painter. tmux stays the durable session owner and the Rust attachment
 * stays the only byte source: this module adds a renderer, not a session
 * manager. Nothing here reads or writes React state — the render loop runs off
 * `requestAnimationFrame` and Ghostty's own damage tracking.
 */
import type {
  TerminalClient,
  TerminalClientEvent,
  TerminalClientTransport,
} from "../../internal/terminalClient";
import { TerminalCanvasRenderer } from "./canvasRenderer";
import { GhosttyKeyEncoder } from "./keyEncoder";
import {
  measurePaint,
  recordAttachStart,
  recordBytes,
  recordFirstPaint,
  recordWasmMemory,
} from "./rendererMeasurement";
import { GhosttyVtTerminal } from "./terminalCore";
import { GhosttyWasmLoadError, loadGhosttyVtRuntime } from "./wasmRuntime";

export type GhosttyWasmFailureReason =
  | "wasm_artifact_unavailable"
  | "wasm_instantiation_failed"
  | "wasm_manifest_unreadable"
  | "renderer_failed";

export interface GhosttyWasmSurfaceOptions {
  agentRunId: string;
  host: HTMLElement;
  transport: TerminalClientTransport;
  /** Forwarded viewer lifecycle, so the host can mirror xterm's status handling. */
  onTransportEvent?: (event: TerminalClientEvent) => void;
  /** The experiment could not run; the caller should fall back to xterm. */
  onFailure?: (reason: GhosttyWasmFailureReason, detail: string) => void;
  artifactUrl?: string;
  pixelRatio?: number;
}

export interface GhosttyWasmSurface {
  focus(): void;
  /** Re-fit to the host box and resize the durable viewer to match. */
  refit(): void;
  detach(): void;
}

const RENDERER = "ghostty-wasm" as const;

export function openGhosttyWasmSurface(
  options: GhosttyWasmSurfaceOptions,
): GhosttyWasmSurface {
  const { host, agentRunId } = options;
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "ghostty-wasm-canvas";
  canvas.style.display = "block";
  const input = document.createElement("textarea");
  input.dataset.testid = "ghostty-wasm-input";
  input.setAttribute("aria-label", "Terminal input");
  input.autocapitalize = "off";
  input.spellcheck = false;
  // Kept in the layout but visually empty: it is the focus and IME target.
  input.style.cssText =
    "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;resize:none;overflow:hidden;";
  host.append(canvas, input);

  let disposed = false;
  let client: TerminalClient | null = null;
  let core: GhosttyVtTerminal | null = null;
  let encoder: GhosttyKeyEncoder | null = null;
  let renderer: TerminalCanvasRenderer | null = null;
  let memory: WebAssembly.Memory | null = null;
  let frameHandle: number | null = null;
  let firstPaintPending = true;
  let geometry = { cols: 80, rows: 24 };

  function fail(reason: GhosttyWasmFailureReason, detail: string): void {
    if (disposed) return;
    options.onFailure?.(reason, detail);
    detach();
  }

  function scheduleFrame(): void {
    if (disposed || frameHandle !== null || !core || !renderer) return;
    frameHandle = requestAnimationFrame(() => {
      frameHandle = null;
      paint();
    });
  }

  function paint(): void {
    if (disposed || !core || !renderer) return;
    try {
      const frame = core.frame();
      if (frame.dirty === "none") return;
      measurePaint(RENDERER, agentRunId, () => renderer?.paint(frame));
      core.clean();
      if (memory) recordWasmMemory(agentRunId, memory.buffer.byteLength);
      if (firstPaintPending) {
        firstPaintPending = false;
        recordFirstPaint(RENDERER, agentRunId);
      }
    } catch (error) {
      fail("renderer_failed", error instanceof Error ? error.message : String(error));
    }
  }

  function fit(): { cols: number; rows: number } {
    if (!renderer) return geometry;
    const box = host.getBoundingClientRect();
    return renderer.resizeTo(Math.max(1, box.width), Math.max(1, box.height));
  }

  function refit(): void {
    if (disposed || !renderer || !core) return;
    const next = fit();
    if (next.cols !== geometry.cols || next.rows !== geometry.rows) {
      geometry = next;
      const metrics = renderer.metrics;
      core.resize(next.cols, next.rows, metrics.width, metrics.height);
      client?.resize(next.cols, next.rows);
    }
    // `resizeTo` cleared the backing store that partial repaint relies on, so
    // the next frame has to redraw everything whether the grid changed or not.
    core.markDirty();
    scheduleFrame();
  }

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => refit());
  resizeObserver?.observe(host);

  function onKeyDown(event: KeyboardEvent): void {
    if (!encoder || !core || !client) return;
    // Application shortcuts stay in the WebView's event system: anything with
    // Command is Studio's, never the terminal's.
    if (event.metaKey) return;
    let bytes: Uint8Array | null;
    try {
      bytes = encoder.encode(core.handle, event);
    } catch (error) {
      fail("renderer_failed", error instanceof Error ? error.message : String(error));
      return;
    }
    if (!bytes) return;
    event.preventDefault();
    client.input(bytes);
  }

  function onPaste(event: ClipboardEvent): void {
    if (!client) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    client.input(new TextEncoder().encode(text));
  }

  function onCompositionEnd(event: CompositionEvent): void {
    if (!client || !event.data) return;
    client.input(new TextEncoder().encode(event.data));
    input.value = "";
  }

  /**
   * Scrolling is forwarded to the durable viewer rather than handled against
   * this renderer's local scrollback, so all three renderers move the same
   * tmux history and a renderer switch cannot change where the user is.
   */
  function onWheel(event: WheelEvent): void {
    if (!client || event.deltaY === 0) return;
    event.preventDefault();
    client.scroll(event.deltaY < 0 ? "up" : "down", Math.max(1, Math.round(Math.abs(event.deltaY) / 20)));
  }

  host.addEventListener("wheel", onWheel, { passive: false });
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("paste", onPaste);
  input.addEventListener("compositionend", onCompositionEnd);

  function handleTransportEvent(event: TerminalClientEvent): void {
    options.onTransportEvent?.(event);
    if (disposed) return;
    if (event.type === "output") {
      recordBytes(RENDERER, agentRunId, event.bytes.length);
      // The viewer is only attached once the terminal exists, so no output
      // can arrive ahead of it.
      core?.write(event.bytes);
      scheduleFrame();
      return;
    }
    if (event.type === "resumed") {
      firstPaintPending = true;
      recordAttachStart(RENDERER, agentRunId, "warm");
    }
  }

  recordAttachStart(RENDERER, agentRunId);
  void loadGhosttyVtRuntime(options.artifactUrl)
    .then((runtime) => {
      if (disposed) return;
      memory = runtime.exports.memory;
      renderer = new TerminalCanvasRenderer(canvas, {
        pixelRatio: options.pixelRatio ?? (globalThis.devicePixelRatio || 1),
      });
      geometry = fit();
      core = new GhosttyVtTerminal(runtime, geometry);
      const metrics = renderer.metrics;
      core.resize(geometry.cols, geometry.rows, metrics.width, metrics.height);
      encoder = new GhosttyKeyEncoder(runtime);
      client = options.transport.attach(
        { agentRunId, cols: geometry.cols, rows: geometry.rows },
        handleTransportEvent,
      );
      scheduleFrame();
    })
    .catch((error) => {
      if (error instanceof GhosttyWasmLoadError) {
        fail(loadFailureReason(error), error.message);
        return;
      }
      fail("renderer_failed", error instanceof Error ? error.message : String(error));
    });

  function detach(): void {
    if (disposed) return;
    disposed = true;
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    resizeObserver?.disconnect();
    host.removeEventListener("wheel", onWheel);
    input.removeEventListener("keydown", onKeyDown);
    input.removeEventListener("paste", onPaste);
    input.removeEventListener("compositionend", onCompositionEnd);
    try {
      client?.detach();
    } catch {
      /* The viewer may already be gone; teardown continues regardless. */
    }
    encoder?.dispose();
    core?.dispose();
    canvas.remove();
    input.remove();
  }

  return {
    focus: () => input.focus(),
    refit,
    detach,
  };
}

function loadFailureReason(error: GhosttyWasmLoadError): GhosttyWasmFailureReason {
  switch (error.failure) {
    case "artifact_unavailable":
      return "wasm_artifact_unavailable";
    case "instantiation_failed":
      return "wasm_instantiation_failed";
    default:
      return "wasm_manifest_unreadable";
  }
}
