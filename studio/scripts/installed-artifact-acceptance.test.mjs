import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { productIdentity } from "../../scripts/product-identity.mjs";
import {
  InstalledArtifactAcceptanceError,
  acceptanceDataDirectory,
  assertAcceptanceResult,
  bundledAcceptanceDriverPath,
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
  rust_only_process_shape: true,
  diagnostics: [
    { kind: "missing_dependency", message: "tmux is required; install it or approve its executable path." },
    { kind: "os_permission", message: "Grant Ticketry access to the selected repository in System Settings." },
  ],
};

test("acceptance ships with an absolute default driver", () => {
  assert.equal(path.isAbsolute(bundledAcceptanceDriverPath), true);
  assert.equal(
    path.basename(bundledAcceptanceDriverPath),
    "installed-artifact-acceptance-driver",
  );
});

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
    "rust_only_process_shape",
  ]) {
    assert.throws(
      () => assertAcceptanceResult({ ...passingResult, [scenario]: false }),
      new RegExp(scenario),
    );
  }
});

test("acceptance reports the driver's redacted scenario failure detail", () => {
  assert.throws(
    () => assertAcceptanceResult({
      ...passingResult,
      durable_agent_terminal_flow: false,
      scenario_failures: {
        durable_agent_terminal_flow: "tmux session was not durable",
      },
    }),
    /durable_agent_terminal_flow \(tmux session was not durable\)/,
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
    TMUX_TMPDIR: "/tmp/acceptance/home/tmp",
    NO_PROXY: "127.0.0.1,localhost",
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
    MUXED_DATA_DIR: "/tmp/acceptance/data",
    MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP: "1",
    MUXED_DESKTOP_ACCEPTANCE_RESULT: "/tmp/acceptance/result.json",
    MUXED_DESKTOP_ACCEPTANCE_NODE: process.execPath,
  });
});

test("acceptance uses the product data directory under the sandboxed home", () => {
  assert.equal(
    acceptanceDataDirectory("/tmp/acceptance/home"),
    path.join(
      "/tmp/acceptance/home/.config",
      productIdentity.defaultDataDirectoryName,
    ),
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
