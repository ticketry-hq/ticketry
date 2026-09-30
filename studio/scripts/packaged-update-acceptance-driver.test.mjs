import assert from "node:assert/strict";
import test from "node:test";

import { runPackagedUpdateScenario } from "./packaged-update-acceptance-driver.mjs";

const VERSION_A = "1.4.0";
const VERSION_B = "1.5.0";

function preservedData() {
  return {
    workTracker: {
      projectId: "project-acceptance",
      workItemIds: ["CODING-1345", "CODING-1346"],
    },
    selectedWorkspace: "/Users/acceptance/workspaces/ticketry",
    preferences: {
      colorScheme: "dark",
      updateChecksEnabled: true,
    },
    approvedExecutablePaths: [
      "/opt/homebrew/bin/codex",
      "/opt/homebrew/bin/tmux",
    ],
    compatibleAgentLoginState: {
      codex: "authenticated",
      claude: "authenticated",
    },
  };
}

function dataProbe() {
  return {
    seedVersionA: async () => preservedData(),
    inspectCurrent: async () => preservedData(),
  };
}

test("packaged A discovers B, confirms the update, and relaunches with data intact", async () => {
  let currentVersion = VERSION_A;
  const browser = {
    openInstalledApp: async () => ({ version: currentVersion, healthy: true }),
    checkForUpdate: async () => ({ status: "available", version: VERSION_B }),
    confirmUpdate: async () => ({ status: "relaunching" }),
    waitForRelaunch: async () => {
      currentVersion = VERSION_B;
    },
    inspectApp: async () => ({ version: currentVersion, healthy: true }),
  };
  const processes = {
    inspectCurrent: async () => ({
      dataDirectoryLock: {
        releasedByVersion: VERSION_A,
        reacquiredByVersion: VERSION_B,
        clean: true,
      },
      active: [{ role: "app", version: VERSION_B }],
      stranded: [],
    }),
  };

  const result = await runPackagedUpdateScenario({
    browser,
    processes,
    data: dataProbe(),
  });

  assert.deepEqual(result, {
    outcome: "installed",
    fromVersion: VERSION_A,
    toVersion: VERSION_B,
    preserved: {
      workTracker: true,
      selectedWorkspace: true,
      preferences: true,
      approvedExecutablePaths: true,
      compatibleAgentLoginState: true,
    },
    lifecycle: {
      dataDirectoryLock: {
        releasedByVersion: VERSION_A,
        reacquiredByVersion: VERSION_B,
        clean: true,
      },
      strandedProcesses: [],
    },
  });
});

test("a wrong-key signature is refused with an actionable error and A remains healthy", async () => {
  const signatureError = {
    code: "update_signature_invalid",
    message: "Update signature verification failed. Ticketry was not changed.",
    action: "Retry after a correctly signed release is published.",
    retryable: false,
  };
  const browser = {
    openInstalledApp: async () => ({ version: VERSION_A, healthy: true }),
    checkForUpdate: async () => ({ status: "available", version: VERSION_B }),
    confirmUpdate: async () => ({ status: "refused", error: signatureError }),
    waitForRelaunch: async () => {
      throw new Error("a refused update must not relaunch");
    },
    inspectApp: async () => ({ version: VERSION_A, healthy: true }),
  };
  const processes = {
    inspectCurrent: async () => ({
      dataDirectoryLock: { ownerVersion: VERSION_A, clean: true },
      active: [{ role: "app", version: VERSION_A }],
      stranded: [],
    }),
  };

  const result = await runPackagedUpdateScenario({
    browser,
    processes,
    data: dataProbe(),
  });

  assert.deepEqual(result, {
    outcome: "installation_refused",
    error: signatureError,
    app: { version: VERSION_A, healthy: true },
    dataPreserved: true,
    lifecycle: {
      dataDirectoryLock: { ownerVersion: VERSION_A, clean: true },
      strandedProcesses: [],
    },
  });
});

test("an unreachable feed reports a retryable actionable error and A remains healthy", async () => {
  const feedError = {
    code: "update_feed_unreachable",
    message: "Ticketry could not reach the update feed.",
    action: "Check the connection and retry.",
    retryable: true,
  };
  const browser = {
    openInstalledApp: async () => ({ version: VERSION_A, healthy: true }),
    checkForUpdate: async () => ({ status: "error", error: feedError }),
    confirmUpdate: async () => {
      throw new Error("an unavailable update must not be confirmed");
    },
    waitForRelaunch: async () => {
      throw new Error("a failed update check must not relaunch");
    },
    inspectApp: async () => ({ version: VERSION_A, healthy: true }),
  };
  const processes = {
    inspectCurrent: async () => ({
      dataDirectoryLock: { ownerVersion: VERSION_A, clean: true },
      active: [{ role: "app", version: VERSION_A }],
      stranded: [],
    }),
  };

  const result = await runPackagedUpdateScenario({
    browser,
    processes,
    data: dataProbe(),
  });

  assert.deepEqual(result, {
    outcome: "check_failed",
    error: feedError,
    app: { version: VERSION_A, healthy: true },
    dataPreserved: true,
    lifecycle: {
      dataDirectoryLock: { ownerVersion: VERSION_A, clean: true },
      strandedProcesses: [],
    },
  });
});
