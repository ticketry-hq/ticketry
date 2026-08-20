import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { notifyManager } from "@tanstack/react-query";

// TanStack Query defers subscriber notifications to a scheduler tick; the
// suite's interaction patterns (act + synchronous assertion) predate that and
// assume zustand's synchronous set→render. Notify synchronously under test.
notifyManager.setScheduler((callback) => callback());

// Launch surfaces read activation from the provider-capabilities payload
// (ADR-0015). Default every test to the server's first-run answer — the three
// built-in providers activated, `agy` absent as the payload always omits it —
// so only tests that are *about* activation have to set this themselves.
const FIRST_RUN_CAPABILITIES = ["claude", "codex", "gemini"].map((agent) => ({
  agent,
  models: [],
}));

// This jsdom build ships without localStorage (which is why the app guards every
// access in a try/catch). Tests that exercise persistence — recent-project MRU,
// nav-collapsed, group-by-epic — need a real backing store, so install a small
// in-memory Storage shim and clear it between tests for isolation.
if (typeof globalThis.localStorage === "undefined") {
  const backing = new Map<string, string>();
  const store: Storage = {
    get length() {
      return backing.size;
    },
    clear: () => backing.clear(),
    getItem: (k) => (backing.has(k) ? backing.get(k)! : null),
    key: (i) => Array.from(backing.keys())[i] ?? null,
    removeItem: (k) => void backing.delete(k),
    setItem: (k, v) => void backing.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
}

// Imported lazily: a static import here would bind the real API module before
// a test file's `vi.mock` of it is registered.
beforeEach(async () => {
  const { setProviderCapabilities } = await import(
    "../features/workflows/providerQueries"
  );
  setProviderCapabilities(FIRST_RUN_CAPABILITIES);
});

afterEach(async () => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this env */
  }
  // Server-state cache isolation: every test starts with an empty TanStack
  // Query cache, mirroring the zustand-store resets tests do themselves.
  const { queryClient } = await import("../shared/query/queryClient");
  queryClient.cancelQueries();
  queryClient.clear();
});
