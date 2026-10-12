import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Writes the installation's disposable tools and the approved-executables
 * registry Ticketry's launch authority resolves them through.
 *
 * The approved `codex` path is a shell wrapper that runs the scenario's own
 * provider script with Node as `node <providerScript> <root> ...providerArgs`,
 * so a scenario changes the provider by passing a different script.
 */
export function provisionDisposableTools(layout, { providerScript, hookBinary, tmux }) {
  mkdirSync(layout.toolDirectory, { recursive: true });
  mkdirSync(layout.dataDirectory, { recursive: true });

  const codex = path.join(layout.toolDirectory, "codex");
  const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  writeFileSync(codex, `#!/bin/sh
exec ${quote(process.execPath)} ${quote(providerScript)} ${quote(layout.root)} "$@"
`, { mode: 0o755 });
  chmodSync(codex, 0o755);

  const hook = path.join(layout.toolDirectory, "ticketry-hook");
  copyFileSync(hookBinary, hook);

  writeFileSync(path.join(layout.dataDirectory, "approved-executables.json"), JSON.stringify({
    tools: [
      { tool: "codex", path: codex },
      { tool: "tmux", path: tmux },
    ],
  }, null, 2));
  return { codex, hook };
}
