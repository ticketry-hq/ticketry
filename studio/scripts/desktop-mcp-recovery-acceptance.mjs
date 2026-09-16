import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

// The caller supplies only its disposable desktop process and private tmux inventory.
export async function verifyLiveMcpRecovery({ root, dataDirectory, child, browser, inventory, restart }) {
  const originalInventory = inventory();
  const originalIdentity = JSON.parse(readFileSync(path.join(root, "provider-started.json"), "utf8"));
  for (const mode of ["orderly", "sigkill"]) {
    if (mode === "orderly") {
      // NSRunningApplication targets this PID without quitting another Ticketry installation.
      execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e",
        `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid}).terminate;`]);
    } else {
      child.kill("SIGKILL");
    }
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, `${mode} desktop exit`);
    const socket = path.join(dataDirectory, "mcp.sock");
    assert.equal(existsSync(socket), mode === "sigkill", `${mode} socket cleanup`);
    writeFileSync(path.join(root, `outage-${mode}`), "");
    await waitFor(() => existsSync(path.join(root, `outage-observed-${mode}`)), `${mode} provider outage`);
    assert.equal(inventory(), originalInventory, `${mode} must preserve private tmux and run identity`);
    ({ child, browser } = await restart());
    writeFileSync(path.join(root, `reconnected-${mode}`), "");
    const evidence = path.join(root, `recovery-${mode}.json`);
    await waitFor(() => existsSync(evidence), `${mode} provider recovery`);
    assert.deepEqual(JSON.parse(readFileSync(evidence, "utf8")).identity, originalIdentity);
    assert.equal(inventory(), originalInventory, `${mode} restart must retain tmux session`);
  }
  return { child, browser };
}
