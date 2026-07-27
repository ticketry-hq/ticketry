// Minimal keyed request coalescing for raw-fetch API paths that several
// stores hit independently (e.g. GET /api/config at bootstrap).

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Share one in-flight promise per key: concurrent callers get the same
 * request instead of issuing duplicates. The entry clears on settle, so a
 * later call always refetches fresh data.
 */
export function dedupeInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

interface CachedEntry {
  value: unknown;
  expiresAt: number;
}

const cached = new Map<string, CachedEntry>();

/**
 * dedupeInFlight plus a small success TTL, for catalog-style resources that
 * change rarely but are refetched as a serial prerequisite of mutations
 * (e.g. issue types before story creation). Failures are never cached.
 */
export function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = cached.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value as T);
  return dedupeInFlight(key, fn).then((value) => {
    cached.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  });
}

/** Drop cached entries whose key starts with the given prefix. */
export function invalidateCached(prefix: string): void {
  for (const key of cached.keys()) {
    if (key.startsWith(prefix)) cached.delete(key);
  }
}
