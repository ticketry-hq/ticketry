import { invoke } from "@tauri-apps/api/core";

import {
  clippedNativeTerminalFrame,
  type NativeTerminalFrame,
} from "./nativeTerminalFrame";

export type NativeTerminalGrid = { columns: number; rows: number };

export type PreparationFrames = {
  /** The most recent frame the preparing viewer has been told about. */
  published: () => NativeTerminalFrame;
  stop: () => void;
};

/**
 * Publishes live host geometry while native attach preparation is in flight.
 *
 * Preparation runs for as long as the native bridge and first redraw take, and
 * the native surface remains hidden when it returns. The frame measured when
 * attachment began can be stale by then, so window changes during preparation
 * are published to the preparing viewer, which applies the newest one before
 * returning its handle. Presentation then uses that handle and the serialized
 * show path, so this only covers the preparation window.
 */
export function publishPreparationFrames(
  host: HTMLElement,
  runId: string,
  attachFrame: NativeTerminalFrame,
): PreparationFrames {
  let published = attachFrame;
  let stopped = false;
  const publish = () => {
    if (stopped) return;
    const frame = clippedNativeTerminalFrame(host);
    if (!frame || sameNativeFrame(frame, published)) return;
    published = frame;
    void invoke("native_terminal_reconcile_frame", { runId, frame }).catch(
      () => {},
    );
  };
  window.addEventListener("resize", publish);
  window.addEventListener("scroll", publish, true);
  return {
    published: () => published,
    stop() {
      stopped = true;
      window.removeEventListener("resize", publish);
      window.removeEventListener("scroll", publish, true);
    },
  };
}

/**
 * Applies host geometry that changed too late for native preparation to adopt
 * it, and resolves with the grid the surface ended up showing. Callers keep the
 * pooled fallback and the ready signal until this settles, so nothing is
 * reported ready at a grid the pane no longer has.
 */
export async function settlePreparedFrame(
  host: HTMLElement,
  handle: string,
  published: NativeTerminalFrame,
  prepared: NativeTerminalGrid,
): Promise<NativeTerminalGrid> {
  const frame = clippedNativeTerminalFrame(host);
  if (!frame || sameNativeFrame(frame, published)) return prepared;
  const status = await invoke<NativeTerminalGrid>("native_terminal_set_frame", {
    handle,
    frame,
  });
  return { columns: status.columns, rows: status.rows };
}

function sameNativeFrame(
  frame: NativeTerminalFrame,
  other: NativeTerminalFrame,
): boolean {
  return (
    frame.x === other.x &&
    frame.y === other.y &&
    frame.width === other.width &&
    frame.height === other.height &&
    frame.viewportWidth === other.viewportWidth &&
    frame.viewportHeight === other.viewportHeight
  );
}
