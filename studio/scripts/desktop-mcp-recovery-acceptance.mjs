import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

// The installation owns quitting, killing and restarting its own desktop PID;
// the caller only restores its view after each restart.
export async function verifyLiveMcpRecovery({ installation, afterRestart }) {
  const { root, dataDirectory } = installation;
  const originalInventory = installation.tmuxInventory();
  const originalIdentity = JSON.parse(readFileSync(path.join(root, "provider-started.json"), "utf8"));
  for (const mode of ["orderly", "sigkill"]) {
    if (mode === "orderly") {
      await installation.quitOrderly();
    } else {
      await installation.killHard();
    }
    const socket = path.join(dataDirectory, "mcp.sock");
    assert.equal(existsSync(socket), mode === "sigkill", `${mode} socket cleanup`);
    writeFileSync(path.join(root, `outage-${mode}`), "");
    await waitFor(() => existsSync(path.join(root, `outage-observed-${mode}`)), `${mode} provider outage`);
    assert.equal(installation.tmuxInventory(), originalInventory, `${mode} must preserve private tmux and run identity`);
    await afterRestart(await installation.restart());
    writeFileSync(path.join(root, `reconnected-${mode}`), "");
    const evidence = path.join(root, `recovery-${mode}.json`);
    await waitFor(() => existsSync(evidence), `${mode} provider recovery`);
    assert.deepEqual(JSON.parse(readFileSync(evidence, "utf8")).identity, originalIdentity);
    assert.equal(installation.tmuxInventory(), originalInventory, `${mode} restart must retain tmux session`);
  }
}
