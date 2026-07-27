import assert from "node:assert/strict";
import test from "node:test";
import {
  InstalledArtifactAcceptanceError,
  assertAcceptanceResult,
  sanitizedDesktopEnvironment,
} from "./installed-artifact-acceptance.mjs";

const passingResult = {
  clean_install: true,
  upgrade_with_existing_data: true,
  failed_update_recovery: true,
  uninstall_preserves_data: true,
  missing_dependency_diagnostic: true,
  os_permission_diagnostic: true,
  durable_agent_terminal_flow: true,
  diagnostics: [
    { kind: "missing_dependency", message: "tmux is required; install it or approve its executable path." },
    { kind: "os_permission", message: "Grant Muxed Studio access to the selected repository in System Settings." },
  ],
};

test("acceptance requires every installed-artifact scenario", () => {
  assert.doesNotThrow(() => assertAcceptanceResult(passingResult));
  const missingRecovery = { ...passingResult, failed_update_recovery: false };
  assert.throws(
    () => assertAcceptanceResult(missingRecovery),
    /failed_update_recovery/,
  );
});

test("acceptance rejects unredacted diagnostics", () => {
  const leakedCredential = {
    ...passingResult,
    diagnostics: [{ message: "API_KEY=not-for-logs" }, passingResult.diagnostics[1]],
  };
  assert.throws(
    () => assertAcceptanceResult(leakedCredential),
    InstalledArtifactAcceptanceError,
  );
});

test("acceptance requires evidence for both actionable diagnostic classes", () => {
  const onlyMissingDependency = {
    ...passingResult,
    diagnostics: [passingResult.diagnostics[0], { ...passingResult.diagnostics[0] }],
  };
  assert.throws(() => assertAcceptanceResult(onlyMissingDependency), /os_permission/);
});

test("GUI launches get only the clean desktop environment", () => {
  const environment = sanitizedDesktopEnvironment({
    home: "/tmp/acceptance/home",
    dataDirectory: "/tmp/acceptance/data",
    resultPath: "/tmp/acceptance/result.json",
  });
  assert.deepEqual(environment, {
    HOME: "/tmp/acceptance/home",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: "/tmp/acceptance/home/tmp",
    MUXED_DATA_DIR: "/tmp/acceptance/data",
    MUXED_DESKTOP_ACCEPTANCE_RESULT: "/tmp/acceptance/result.json",
  });
});
