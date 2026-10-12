import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildDesktopAcceptanceApplication,
  requireTmux,
  runDesktopInstallationScenario,
} from "./desktop-installation.mjs";
import { resolveEditionBuild } from "./edition-build-policy.mjs";
import { listSocketMcpTools } from "./mcp-socket-client.mjs";
import { subtreeStubHarness } from "./desktop-subtree-stub/harness.mjs";
import { assertRunningEdition, casesForEdition } from "./desktop-subtree-acceptance/edition-cases.mjs";
import { createCampaign } from "./desktop-subtree-acceptance/campaign-hierarchy.mjs";
import { prepareCoreInstallation } from "./desktop-subtree-acceptance/core-fixture.mjs";
import { runParallelCase } from "./desktop-subtree-acceptance/parallel-case.mjs";
import { preparePocockInstallation } from "./desktop-subtree-acceptance/pocock-fixture.mjs";
import { runRecoveryCase } from "./desktop-subtree-acceptance/recovery-case.mjs";
import { runSerialCase } from "./desktop-subtree-acceptance/serial-case.mjs";

/**
 * The desktop **subtree** journey: the edition chosen by `TICKETRY_EDITION`
 * (default pocock) is built, proven to be the running edition, and then runs
 * its fixed case list over one isolated installation whose approved `codex`
 * executable is the scriptable `desktop-subtree-stub.mjs`. Separate from the
 * single-item `test:e2e:desktop` journey.
 */
const providerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "desktop-subtree-stub.mjs");
const CASES = Object.freeze({ serial: runSerialCase, parallel: runParallelCase, recovery: runRecoveryCase });
const FIXTURES = Object.freeze({
  pocock: { prepare: preparePocockInstallation },
  core: { prepare: prepareCoreInstallation },
});

async function runtimeEdition(browser) {
  const configuration = await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("desktop_runtime_configuration")
      .then(done).catch((error) => done({ transportError: String(error) }));
  });
  if (configuration?.transportError) throw new Error(`desktop_runtime_configuration failed: ${configuration.transportError}`);
  return configuration?.edition;
}

async function subtreeJourney(installation, edition, cases) {
  const stubs = subtreeStubHarness(installation.root);
  // Stubs and their MCP bridges outlive Ticketry inside private tmux; end them
  // too if the journey is interrupted.
  installation.trackHelperProcesses(() => stubs.startRecords().flatMap((record) => [
    record.pid,
    record.bridge_pid,
    ...(stubs.completionRecord(record.agent_run_id)?.bridge_pids ?? []),
  ]));
  const browser = await installation.start();
  assertRunningEdition(edition, {
    runtimeEdition: await runtimeEdition(browser),
    toolNames: await listSocketMcpTools(installation.dataDirectory),
  });
  console.log(`Running edition confirmed: ${edition}; cases: ${cases.join(", ")}.`);

  const fixtures = FIXTURES[edition];
  const fixture = await fixtures.prepare(installation);
  for (const name of cases) {
    // Each case gets its own root and children.
    const campaign = await createCampaign(installation, fixture, { label: name, stubs });
    // Recovery restarts Ticketry, so the session is read afresh for each case.
    await installation.browser.refresh();
    await CASES[name]({ installation, stubs, fixture, campaign, edition });
  }
  console.log(`Ticketry desktop subtree acceptance passed (${edition}).`);
}

requireTmux();
// The edition and its case list are fixed before anything builds or starts.
const { edition } = resolveEditionBuild(process.env);
const cases = casesForEdition(edition);
buildDesktopAcceptanceApplication();
await runDesktopInstallationScenario({
  providerScript,
  diagnostics: { label: "desktop-subtree-acceptance", evidenceFiles: ["subtree-stub"] },
}, (installation) => subtreeJourney(installation, edition, cases));
