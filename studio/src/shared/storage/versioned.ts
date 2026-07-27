// Versioned localStorage access (client-localstorage-schema): persisted keys
// carry a `:vN` suffix so future shape changes can migrate explicitly instead
// of guessing. Reading falls back to (and consumes) legacy spellings once.

/** Read `key`, migrating the first present legacy key into it. */
export function readVersionedItem(
  key: string,
  legacyKeys: readonly string[] = [],
): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    for (const legacyKey of legacyKeys) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(legacyKey);
        return legacy;
      }
    }
  } catch {
    /* unavailable storage degrades to null */
  }
  return null;
}
