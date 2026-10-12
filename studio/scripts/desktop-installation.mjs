import { rmSync } from "node:fs";
import path from "node:path";

import { buildHookRunner } from "./desktop-installation/acceptance-build.mjs";
import { provisionDisposableTools } from "./desktop-installation/disposable-tools.mjs";
import { captureFailureDiagnostics } from "./desktop-installation/failure-diagnostics.mjs";
import { createInstallationLayout, installApplication } from "./desktop-installation/installation-layout.mjs";
import { cleanupOnInterrupt } from "./desktop-installation/interrupt-cleanup.mjs";
import { waitForMcpPing } from "./desktop-installation/mcp-readiness.mjs";
import { guardObsoleteMcpPorts } from "./desktop-installation/obsolete-mcp-port-guard.mjs";
import { privateTmux, privateTmuxSocket, requireTmux } from "./desktop-installation/private-tmux.mjs";
import {
  killHard,
  quitOrderly,
  terminateHelperProcesses,
} from "./desktop-installation/process-control.mjs";
import {
  availablePort,
  connectToStudio,
  defaultDesktopBinary,
  spawnTicketry,
  stopProcess,
} from "./desktop-webdriver-session.mjs";

export { buildDesktopAcceptanceApplication } from "./desktop-installation/acceptance-build.mjs";
export { requireTmux } from "./desktop-installation/private-tmux.mjs";

/**
 * One fresh, isolated desktop Ticketry installation for an acceptance
 * scenario: its temporary root, application copy, disposable tools, private
 * tmux server, process lifetime and WebDriver session, failure diagnostics and
 * cleanup.
 *
 * A scenario supplies only its provider script, registered as the approved
 * `codex` executable, and drives `installation.browser`. Start, orderly quit,
 * SIGKILL and restart always reuse the same data directory. Cleanup stops the
 * app, the private tmux server and tracked helper processes, then removes the
 * root — on success, failure, and SIGINT/SIGTERM.
 */
export function openDesktopInstallation({
  binary = defaultDesktopBinary(),
  hookBinary,
  providerScript,
  tmux = requireTmux(),
  installSignalHandlers = true,
} = {}) {
  if (!providerScript) throw new Error("A desktop installation needs a provider script");
  const layout = createInstallationLayout();
  const tmuxServer = privateTmux(tmux, layout.tmuxDirectory);
  const helperTrackers = [];
  let portGuard;
  let cleanupPromise;
  let removeSignalHandlers = () => {};

  const installation = {
    ...layout,
    tmux,
    stdout: [],
    stderr: [],
    child: undefined,
    browser: undefined,
    environment: {
      MUXED_DATA_DIR: layout.dataDirectory,
      CODEX_HOME: layout.codexHome,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: privateTmuxSocket,
      TMUX_TMPDIR: layout.tmuxDirectory,
      TMPDIR: layout.runtimeTempDirectory,
      MUXED_OUTPUT_SWEEP_SECONDS: "1",
      MUXED_DEVELOPMENT_LOG_PATH: path.join(layout.artifacts, "ticketry.log"),
    },

    /** Copies the application, writes the disposable tools and registry. */
    async provision() {
      Object.assign(installation, installApplication(layout, {
        binary,
        provisionTools: () => {
          const hook = hookBinary ?? buildHookRunner();
          const tools = provisionDisposableTools(layout, { providerScript, hookBinary: hook, tmux });
          installation.codex = tools.codex;
          return tools.hook;
        },
      }));
    },

    /**
     * Spawns Ticketry over this installation's data directory and connects
     * WebDriver. The first start holds the obsolete MCP ports beforehand and
     * proves they stayed held once MCP answers.
     */
    async start({ sweepMillis = 250, waitForMcp = true } = {}) {
      const firstStart = !portGuard;
      portGuard ??= await guardObsoleteMcpPorts();
      const port = await availablePort();
      installation.child = spawnTicketry(installation.binary, {
        ...installation.environment,
        TAURI_WEBDRIVER_PORT: String(port),
        TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS: String(sweepMillis),
      }, installation.stdout, installation.stderr);
      installation.browser = await connectToStudio(port, installation.child);
      if (waitForMcp) await waitForMcpPing(layout.dataDirectory, installation.child);
      if (firstStart) await portGuard.verifyStillOccupied();
      return installation.browser;
    },

    /** Ends the WebDriver session, then SIGTERM (escalating to SIGKILL). */
    async stop() {
      await installation.browser?.deleteSession();
      installation.browser = undefined;
      await stopProcess(installation.child);
    },

    /** Asks this PID's NSRunningApplication to terminate, as a user quit does. */
    async quitOrderly() {
      await quitOrderly(installation.child);
    },

    async killHard() {
      await killHard(installation.child);
    },

    /** Starts again over the same data directory after a stop, quit or kill. */
    async restart(options) {
      return await installation.start(options);
    },

    tmuxInventory: tmuxServer.inventory,
    tmuxCapture: tmuxServer.capture,
    waitForTmuxEmpty: tmuxServer.waitForEmpty,

    /**
     * Registers a source of helper PIDs (provider, bridge) to end on cleanup.
     * Only processes whose command line names this installation's root are
     * ended.
     */
    trackHelperProcesses(listPids) {
      helperTrackers.push(listPids);
    },

    async captureFailureDiagnostics({ label = "desktop-agent-acceptance", evidenceFiles = [] } = {}) {
      return await captureFailureDiagnostics(installation, { label, evidenceFiles });
    },

    cleanup() {
      return cleanupPromise ??= (async () => {
        if (installation.browser) await installation.browser.deleteSession().catch(() => {});
        await stopProcess(installation.child);
        await portGuard?.release();
        tmuxServer.killServer();
        const helperPids = helperTrackers.flatMap((listPids) => {
          try {
            return listPids();
          } catch {
            return [];
          }
        });
        await terminateHelperProcesses(helperPids, { installationRoot: layout.root });
        rmSync(layout.root, { recursive: true, force: true });
      })();
    },

    async dispose() {
      removeSignalHandlers();
      await installation.cleanup();
    },
  };
  if (installSignalHandlers) removeSignalHandlers = cleanupOnInterrupt(installation.cleanup);
  return installation;
}

/** Opens and provisions an installation, cleaning up if provisioning fails. */
export async function createDesktopInstallation(options) {
  const installation = openDesktopInstallation(options);
  try {
    await installation.provision();
  } catch (error) {
    await installation.dispose();
    throw error;
  }
  return installation;
}

/**
 * Runs one scenario against a fresh installation. A failure anywhere,
 * provisioning included, retains diagnostics before cleanup.
 */
export async function runDesktopInstallationScenario(
  { diagnostics = {}, ...options },
  scenario,
) {
  const installation = openDesktopInstallation(options);
  try {
    await installation.provision();
    return await scenario(installation);
  } catch (error) {
    await installation.captureFailureDiagnostics(diagnostics);
    throw error;
  } finally {
    await installation.dispose();
  }
}
