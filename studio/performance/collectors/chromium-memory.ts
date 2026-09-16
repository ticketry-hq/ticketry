import { createWriteStream } from "node:fs";
import { once } from "node:events";
import type { CDPSession, Page } from "@playwright/test";

/**
 * Chromium heap and DOM sampling.
 *
 * Sampling happens at batch boundaries, never inside a timed interaction, and
 * garbage collection is only ever forced inside the opt-in retention
 * experiment. Chromium JS heap bytes and the macOS physical footprint stay
 * separate numbers here and in every report: adding them together produces a
 * total that describes nothing.
 */
export interface MemorySample {
  at: string;
  label: string;
  usedJsHeapBytes: number | null;
  totalJsHeapBytes: number | null;
  domNodeCount: number | null;
  documentCount: number | null;
  jsEventListenerCount: number | null;
  reason: string | null;
}

export async function openMemorySession(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.enable");
  return session;
}

export async function sampleMemory(
  session: CDPSession,
  label: string,
): Promise<MemorySample> {
  const at = new Date().toISOString();
  try {
    const usage = await session.send("Runtime.getHeapUsage");
    const counters = await session.send("Memory.getDOMCounters");
    return {
      at,
      label,
      usedJsHeapBytes: usage.usedSize,
      totalJsHeapBytes: usage.totalSize,
      domNodeCount: counters.nodes,
      documentCount: counters.documents,
      jsEventListenerCount: counters.jsEventListeners,
      reason: null,
    };
  } catch (error) {
    return {
      at,
      label,
      usedJsHeapBytes: null,
      totalJsHeapBytes: null,
      domNodeCount: null,
      documentCount: null,
      jsEventListenerCount: null,
      reason: `CDP memory sampling failed: ${(error as Error).message}`,
    };
  }
}

/** Only ever called from the opt-in retention experiment, never from a timing run. */
export async function collectGarbage(session: CDPSession): Promise<void> {
  await session.send("HeapProfiler.collectGarbage");
}

/**
 * Stream a `.heapsnapshot` to disk.
 *
 * Chunks are piped straight into the file with backpressure respected; a
 * multi-hundred-megabyte snapshot must never be concatenated in Node's own
 * heap while the run is investigating memory. Listeners are always removed,
 * the timeout is enforced, and a partial file is reported as partial.
 */
export async function captureHeapSnapshot(
  session: CDPSession,
  filePath: string,
  { timeoutMs = 180_000 }: { timeoutMs?: number } = {},
): Promise<{ filePath: string; bytes: number; complete: boolean; reason: string | null }> {
  const stream = createWriteStream(filePath);
  let bytes = 0;
  let pending = Promise.resolve();
  const onChunk = ({ chunk }: { chunk: string }) => {
    bytes += Buffer.byteLength(chunk);
    pending = pending.then(() =>
      stream.write(chunk) ? undefined : once(stream, "drain").then(() => undefined)
    );
  };
  session.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  let reason: string | null = null;
  let complete = false;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`heap snapshot exceeded ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([
        session.send("HeapProfiler.takeHeapSnapshot", {
          reportProgress: false,
          captureNumericValue: false,
        }),
        timeout,
      ]);
      await pending;
      complete = true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    reason = (error as Error).message;
  } finally {
    session.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await new Promise<void>((resolve) => stream.end(resolve));
  }
  return { filePath, bytes, complete, reason };
}
