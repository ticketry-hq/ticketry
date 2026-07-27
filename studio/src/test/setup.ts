import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Launch surfaces read activation from the provider-capabilities payload
// (ADR-0015). Default every test to the server's first-run answer — the three
// built-in providers activated, `agy` absent as the payload always omits it —
// so only tests that are *about* activation have to set this themselves.
const FIRST_RUN_CAPABILITIES = ["claude", "codex", "gemini"].map((agent) => ({
  agent,
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: [],
  model_prefixes: [],
  reasoning_levels: [],
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
  const { useLaunchProviderCatalog } = await import(
    "../features/workflows/launchProviderCatalog"
  );
  useLaunchProviderCatalog.setState({
    capabilities: FIRST_RUN_CAPABILITIES,
    loaded: true,
  });
});

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this env */
  }
});
