const startedAt = performance.now();
let previousAt = startedAt;
const startupId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

/** Write compact startup durations through the existing frontend log bridge. */
export function recordStartupStage(stage: string): void {
  const now = performance.now();
  console.info("[startup-trace]", JSON.stringify({
    startup_id: startupId,
    stage,
    elapsed_ms: Math.round(now - startedAt),
    duration_ms: Math.round(now - previousAt),
  }));
  previousAt = now;
}
