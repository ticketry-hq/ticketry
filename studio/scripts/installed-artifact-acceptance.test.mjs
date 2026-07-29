import assert from "node:assert/strict";
import test from "node:test";
import {
  InstalledArtifactAcceptanceError,
  acceptanceDataDirectory,
  assertAcceptanceResult,
  runDriverAfterColdLaunch,
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
  offline_packaged_skill_matrix: true,
  skill_configuration_unchanged: true,
  skill_overlay_cleanup: true,
  packaged_skill_providers: {
    claude: ["grill-with-docs", "to-spec", "to-tickets"],
    codex: ["grill-with-docs", "to-spec", "to-tickets"],
    agy: ["grill-with-docs", "to-spec", "to-tickets"],
    gemini: ["grill-with-docs", "to-spec", "to-tickets"],
  },
  diagnostics: [
    { kind: "missing_dependency", message: "tmux is required; install it or approve its executable path." },
    { kind: "os_permission", message: "Grant Ticketry access to the selected repository in System Settings." },
  ],
};

test("acceptance requires every installed-artifact scenario", () => {
  assert.doesNotThrow(() => assertAcceptanceResult(passingResult));
  for (const scenario of [
    "clean_install",
    "upgrade_with_existing_data",
    "failed_update_recovery",
    "uninstall_preserves_data",
    "missing_dependency_diagnostic",
    "os_permission_diagnostic",
    "durable_agent_terminal_flow",
    "offline_packaged_skill_matrix",
    "skill_configuration_unchanged",
    "skill_overlay_cleanup",
  ]) {
    assert.throws(
      () => assertAcceptanceResult({ ...passingResult, [scenario]: false }),
      new RegExp(scenario),
    );
  }
});

test("acceptance requires packaged skill provider evidence", () => {
  assert.throws(
    () => assertAcceptanceResult({ ...passingResult, packaged_skill_providers: undefined }),
    /omitted packaged skill provider evidence/,
  );
  assert.throws(
    () => assertAcceptanceResult({
      ...passingResult,
      packaged_skill_providers: {
        ...passingResult.packaged_skill_providers,
        codex: ["grill-with-docs", "to-spec"],
      },
    }),
    /required packaged skills for codex/,
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
    NO_PROXY: "127.0.0.1,localhost",
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
    MUXED_DATA_DIR: "/tmp/acceptance/data",
    MUXED_DESKTOP_ACCEPTANCE_RESULT: "/tmp/acceptance/result.json",
    MUXED_DESKTOP_ACCEPTANCE_NODE: process.execPath,
  });
});

test("acceptance uses the product data directory under the sandboxed home", () => {
  assert.equal(
    acceptanceDataDirectory("/tmp/acceptance/home"),
    "/tmp/acceptance/home/.config/worktracker-studio",
  );
});

test("the driver owns the bounded clean-install launch and all scenarios", async () => {
  const events = [];
  const appPath = "/tmp/acceptance/Applications/Ticketry.app";
  const driverPath = "/tmp/acceptance/driver";
  const environment = { HOME: "/tmp/acceptance/home" };

  await runDriverAfterColdLaunch({
    appPath,
    driverPath,
    environment,
    workspace: "/tmp/acceptance",
    run: async (command, args, options) => {
      assert.equal(command, driverPath);
      assert.deepEqual(args, [appPath]);
      assert.deepEqual(options, { cwd: "/tmp/acceptance", env: environment });
      events.push("driver-started");
    },
  });

  assert.deepEqual(events, ["driver-started"]);
});
