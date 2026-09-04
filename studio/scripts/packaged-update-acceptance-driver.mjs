import { isDeepStrictEqual } from "node:util";

export class PackagedUpdateAcceptanceDriverError extends Error {}

function preserved(before, after) {
  return {
    workTracker: isDeepStrictEqual(after.workTracker, before.workTracker),
    selectedWorkspace: isDeepStrictEqual(
      after.selectedWorkspace,
      before.selectedWorkspace,
    ),
    preferences: isDeepStrictEqual(after.preferences, before.preferences),
    approvedExecutablePaths: isDeepStrictEqual(
      after.approvedExecutablePaths,
      before.approvedExecutablePaths,
    ),
    compatibleAgentLoginState: isDeepStrictEqual(
      after.compatibleAgentLoginState,
      before.compatibleAgentLoginState,
    ),
  };
}

function allPreserved(before, after) {
  return Object.values(preserved(before, after)).every(Boolean);
}

function refusalResult(outcome, error, app, dataPreserved, processState) {
  return {
    outcome,
    error,
    app,
    dataPreserved,
    lifecycle: {
      dataDirectoryLock: processState.dataDirectoryLock,
      strandedProcesses: processState.stranded,
    },
  };
}

export async function runPackagedUpdateScenario({ browser, processes, data }) {
  const initialApp = await browser.openInstalledApp();
  if (!initialApp?.healthy || typeof initialApp.version !== "string") {
    throw new PackagedUpdateAcceptanceDriverError(
      "packaged version A did not start healthy",
    );
  }
  const before = await data.seedVersionA();
  const check = await browser.checkForUpdate();

  if (check.status === "error") {
    const [app, after, processState] = await Promise.all([
      browser.inspectApp(),
      data.inspectCurrent(),
      processes.inspectCurrent(),
    ]);
    return refusalResult(
      "check_failed",
      check.error,
      app,
      allPreserved(before, after),
      processState,
    );
  }

  if (check.status !== "available" || typeof check.version !== "string") {
    throw new PackagedUpdateAcceptanceDriverError(
      "version A did not discover a packaged update",
    );
  }

  const confirmation = await browser.confirmUpdate();
  if (confirmation.status === "refused") {
    const [app, after, processState] = await Promise.all([
      browser.inspectApp(),
      data.inspectCurrent(),
      processes.inspectCurrent(),
    ]);
    return refusalResult(
      "installation_refused",
      confirmation.error,
      app,
      allPreserved(before, after),
      processState,
    );
  }

  if (confirmation.status !== "relaunching") {
    throw new PackagedUpdateAcceptanceDriverError(
      "update confirmation neither refused nor requested relaunch",
    );
  }

  await browser.waitForRelaunch();
  const [updatedApp, after, processState] = await Promise.all([
    browser.inspectApp(),
    data.inspectCurrent(),
    processes.inspectCurrent(),
  ]);
  return {
    outcome: "installed",
    fromVersion: initialApp.version,
    toVersion: updatedApp.version,
    preserved: preserved(before, after),
    lifecycle: {
      dataDirectoryLock: processState.dataDirectoryLock,
      strandedProcesses: processState.stranded,
    },
  };
}
