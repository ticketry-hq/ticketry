/**
 * Boots the servers for upcoming invocations while the current one runs. Each
 * invocation still owns a fresh profile and server; only the waiting moves.
 * Every server enters the machine-wide queue (stackSlots.mjs), so warming never
 * exceeds the memory budget: a warm start simply waits for a slot.
 */

// These features exercise what happens around server startup, so their server
// starts only when their turn comes, as it did before warming existed.
export const coldStartFeatures = new Set(["startup-and-service-health", "background-discovery-and-recovery"]);

export function warmLookahead(environment = process.env) {
  const value = environment.TICKETRY_E2E_LOOKAHEAD;
  if (value === undefined || value === "") return 1;
  if (!/^\d+$/.test(value)) throw new Error("TICKETRY_E2E_LOOKAHEAD must be a non-negative integer");
  return Number(value);
}

export function createWarmPool({ count, start, isCold = () => false, lookahead = 1 }) {
  const started = new Map();
  const taken = new Set();
  const prewarmed = new Set();
  const ensure = (index) => {
    if (!started.has(index)) {
      const stack = start(index);
      // A warm start that fails is reported when its invocation takes it.
      stack.catch(() => {});
      started.set(index, stack);
    }
    return started.get(index);
  };
  return {
    /** Resolves to this invocation's ready server, then warms the next ones. */
    async take(index) {
      taken.add(index);
      if (started.has(index)) prewarmed.add(index);
      const stack = await ensure(index);
      for (let next = index + 1; next < Math.min(count, index + 1 + lookahead); next += 1) {
        if (!isCold(next)) ensure(next);
      }
      return stack;
    },
    /** Whether the invocation's server was started before its turn. */
    warmed: (index) => prewarmed.has(index),
    /** Stops servers that were warmed but never taken; returns their indexes. */
    async close() {
      const untaken = [...started.keys()].filter((index) => !taken.has(index));
      await Promise.all(untaken.map(async (index) => {
        try { await (await started.get(index)).stop(); } catch { /* failed to start; nothing to stop */ }
      }));
      return untaken;
    },
  };
}
