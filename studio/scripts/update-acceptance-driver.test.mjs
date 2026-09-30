import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESERVED_WORK_ITEM_NAME,
  UpdateAcceptanceDriverError,
  mergeDriverEvidence,
  preservationEvidence,
  requiredDriverEnvironment,
  seedProbeStatement,
  seedStatements,
  strandedProcessEvidence,
} from "./update-acceptance-driver.mjs";

const environment = {
  TICKETRY_UPDATE_ACCEPTANCE_RESULT: "/tmp/run/update-result.json",
  TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION: "0.3.0",
  TICKETRY_UPDATE_ACCEPTANCE_CASE: "signed",
  TICKETRY_UPDATE_FEED_URL: "https://localhost:52001/releases/latest/download/latest.json",
  MUXED_DATA_DIR: "/tmp/run/home/.config/ticketry",
};

const preserved = {
  seededWorkItems: "1",
  observedWorkItems: "1",
  seededWorkspace: '{"workspace":"update-acceptance"}',
  observedWorkspace: '{"workspace":"update-acceptance"}',
  seededApprovals: '{"approved":["/usr/bin/true"]}',
  observedApprovals: '{"approved":["/usr/bin/true"]}',
  seededPreferences: '{"selected_workspace":"update-acceptance"}',
  observedPreferences: '{"selected_workspace":"update-acceptance"}',
};

test("the driver requires the run's feed, case, and data directory", () => {
  assert.deepEqual(requiredDriverEnvironment(environment), {
    resultPath: "/tmp/run/update-result.json",
    expectedVersion: "0.3.0",
    feedCase: "signed",
    dataDirectory: "/tmp/run/home/.config/ticketry",
  });
  for (const key of Object.keys(environment)) {
    assert.throws(
      () => requiredDriverEnvironment({ ...environment, [key]: "" }),
      new RegExp(key),
    );
  }
});

test("the app must stay alive past startup for the update to happen", () => {
  assert.throws(
    () => requiredDriverEnvironment({
      ...environment,
      MUXED_DESKTOP_ACCEPTANCE_EXIT_AFTER_STARTUP: "1",
    }),
    /must not be set/,
  );
});

test("the seed plants a row the probe can find again", () => {
  const statements = seedStatements("2026-08-31T00:00:00Z");

  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS ticketry_update_acceptance_seed/);
  assert.ok(statements[1].includes(PRESERVED_WORK_ITEM_NAME));
  assert.ok(seedProbeStatement().includes(PRESERVED_WORK_ITEM_NAME));
  assert.match(seedProbeStatement(), /^SELECT count\(\*\)/);
});

test("preservation passes only when every promised entry survived", () => {
  assert.deepEqual(preservationEvidence(preserved), {
    work_tracker_data_preserved: true,
    selected_workspace_restored: true,
    approved_paths_and_preferences_preserved: true,
  });

  assert.equal(
    preservationEvidence({ ...preserved, observedWorkItems: "0" }).work_tracker_data_preserved,
    false,
  );
  assert.equal(
    preservationEvidence({ ...preserved, observedWorkspace: undefined })
      .selected_workspace_restored,
    false,
  );
  assert.equal(
    preservationEvidence({ ...preserved, observedApprovals: "{}" })
      .approved_paths_and_preferences_preserved,
    false,
  );
  assert.equal(
    preservationEvidence({ ...preserved, observedPreferences: "{}" })
      .approved_paths_and_preferences_preserved,
    false,
  );
});

test("preservation cannot pass on data that was never seeded", () => {
  assert.deepEqual(
    preservationEvidence({
      seededWorkItems: "0",
      observedWorkItems: "0",
      seededWorkspace: "",
      observedWorkspace: "",
      seededApprovals: "",
      observedApprovals: "",
      seededPreferences: "",
      observedPreferences: "",
    }),
    {
      work_tracker_data_preserved: false,
      selected_workspace_restored: false,
      approved_paths_and_preferences_preserved: false,
    },
  );
});

test("a process still holding the run's sandbox is a stranded child", () => {
  const clean = strandedProcessEvidence(
    "  PID COMMAND\n 4242 /usr/bin/login\n 4243 /Applications/Safari.app/Contents/MacOS/Safari\n",
    { sandboxRoot: "/tmp/ticketry-update-acceptance-a1b2", driverPid: 900 },
  );
  assert.deepEqual(clean, { no_stranded_processes: true });

  const stranded = strandedProcessEvidence(
    " 4242 /usr/bin/login\n"
      + " 4310 /tmp/ticketry-update-acceptance-a1b2/Applications/Ticketry.app/Contents/MacOS/ticketry\n",
    { sandboxRoot: "/tmp/ticketry-update-acceptance-a1b2", driverPid: 900 },
  );
  assert.equal(stranded.no_stranded_processes, false);
  assert.match(
    stranded.case_failures.no_stranded_processes,
    /1 process\(es\) survived the update relaunch/,
  );
});

test("the driver itself is never counted as a stranded process", () => {
  const evidence = strandedProcessEvidence(
    " 900 node /tmp/ticketry-update-acceptance-a1b2/driver.mjs\n",
    { sandboxRoot: "/tmp/ticketry-update-acceptance-a1b2", driverPid: 900 },
  );

  assert.deepEqual(evidence, { no_stranded_processes: true });
});

test("driver evidence adds to what the app already reported", () => {
  const merged = mergeDriverEvidence(
    {
      installed_on_confirmation: true,
      updater_signature_verified: true,
      case_failures: { discovered_available_version: "feed served version 0.2.9" },
    },
    {
      work_tracker_data_preserved: true,
      no_stranded_processes: false,
      case_failures: { no_stranded_processes: "1 process(es) survived the update relaunch" },
    },
  );

  assert.equal(merged.installed_on_confirmation, true);
  assert.equal(merged.work_tracker_data_preserved, true);
  assert.equal(merged.no_stranded_processes, false);
  assert.deepEqual(merged.case_failures, {
    discovered_available_version: "feed served version 0.2.9",
    no_stranded_processes: "1 process(es) survived the update relaunch",
  });
  assert.deepEqual(mergeDriverEvidence(undefined, { no_stranded_processes: true }), {
    no_stranded_processes: true,
  });
  assert.deepEqual(mergeDriverEvidence("not an object", { no_stranded_processes: true }), {
    no_stranded_processes: true,
  });
});

test("the driver error type is exported for the harness to catch", () => {
  assert.ok(new UpdateAcceptanceDriverError("failure") instanceof Error);
});
