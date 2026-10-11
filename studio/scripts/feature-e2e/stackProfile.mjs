import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const sprintProviderFixture = join(studioRoot, "e2e", "fixtures", "sprint-provider.mjs");

const quoteShell = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

/**
 * Writes the provider fixtures a profile needs before its server starts. Both
 * the Playwright config and the warm pool call this, so a server booted ahead
 * of its test sees the same profile as one Playwright starts itself.
 */
export function prepareStackProfile(dataDirectory, { interpreter = process.execPath } = {}) {
  const providerDirectory = join(dataDirectory, "provider-fixture");
  mkdirSync(providerDirectory, { recursive: true });
  // Interactive launch discovery probes the approved absolute executable with a
  // clean environment, so its wrapper binds the current interpreter explicitly.
  const fixtureTools = join(dataDirectory, "fixture-tools");
  mkdirSync(fixtureTools, { recursive: true });
  const fixtureCodex = join(fixtureTools, "codex");
  writeFileSync(fixtureCodex, `#!/bin/sh
exec ${quoteShell(interpreter)} ${quoteShell(sprintProviderFixture)} "$@"
`, { mode: 0o755 });
  writeFileSync(join(dataDirectory, "approved-executables.json"), JSON.stringify({
    tools: [{ tool: "codex", path: fixtureCodex }],
  }));
  return { providerDirectory, fixtureCodex };
}

/** Environment for `scripts/web-dev.mjs` serving one e2e profile. */
export function stackServerEnvironment({ dataDirectory, providerDirectory, frontendPort, adapterPort }) {
  return {
    MUXED_FRONTEND_PORT: String(frontendPort),
    ...(adapterPort ? { TICKETRY_GRAPHQL_ADAPTER_PORT: String(adapterPort) } : {}),
    MUXED_DATA_DIR: dataDirectory,
    MUXED_FORCE_SQLITE: "true",
    MUXED_TMUX_SOCKET: `ticketry-e2e-${basename(dataDirectory)}`,
    MUXED_APPROVED_CODEX_PATH: sprintProviderFixture,
    TICKETRY_E2E_PROVIDER_DIR: providerDirectory,
    // Vite's `--open` would otherwise start another copy of the app in the
    // developer's own browser for every e2e server.
    BROWSER: "none",
  };
}
