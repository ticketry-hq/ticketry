import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  availablePort,
  connectToStudio,
  defaultDesktopBinary,
  spawnTicketry,
  stopProcess,
} from "./desktop-webdriver-session.mjs";
import { proveDescriptionSaveAndStorySwitch } from "./desktop-description-acceptance.mjs";
import { verifyLiveMcpRecovery } from "./desktop-mcp-recovery-acceptance.mjs";
import { callSocketMcpTool } from "./mcp-socket-client.mjs";
import { captureIdea, click, openExistingStory } from "./desktop-studio-ui.mjs";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(studioRoot, "..");
const builtBinary = defaultDesktopBinary();
const tmux = process.env.TICKETRY_DESKTOP_ACCEPTANCE_TMUX
  ?? ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find(existsSync);
const obsoleteMcpPorts = Array.from({ length: 10 }, (_, index) => 8123 + index);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

async function occupyPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, resolve);
  });
  return server;
}

async function portIsOccupied(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}

async function waitForMcpPing(dataDirectory, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ticketry exited before its MCP listener became ready (${child.exitCode})`);
    }
    try {
      const result = await callSocketMcpTool(dataDirectory, "mcp_ping", {}, 1_000);
      if (result.structuredContent?.status === "ok"
          && result.structuredContent.server === "ticketry") {
        const projects = await callSocketMcpTool(dataDirectory, "list_projects", {}, 1_000);
        if (!projects.isError && Array.isArray(projects.structuredContent?.result)) return;
      }
    } catch {
      // WebDriver can start before MCP reconciliation finishes.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Ticketry MCP did not answer through ${path.join(dataDirectory, "mcp.sock")}`);
}

function provisionDisposableTools(root) {
  const toolDirectory = path.join(root, "bin");
  const dataDirectory = path.join(root, "data");
  const marker = path.join(root, "provider-started.json");
  mkdirSync(toolDirectory, { recursive: true });
  mkdirSync(dataDirectory, { recursive: true });

  const codex = path.join(toolDirectory, "codex");
  const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const providerFixture = path.join(studioRoot, "scripts", "desktop-acceptance-provider.mjs");
  writeFileSync(codex, `#!/bin/sh
exec ${quote(process.execPath)} ${quote(providerFixture)} ${quote(root)} "$@"
`, { mode: 0o755 });
  chmodSync(codex, 0o755);

  const hook = path.join(toolDirectory, "ticketry-hook");
  run("cargo", [
    "build",
    "--locked",
    "--manifest-path",
    path.join(studioRoot, "src-tauri", "Cargo.toml"),
    "-p",
    "ticketry-hook",
    "--bin",
    "ticketry-hook",
  ]);
  copyFileSync(path.join(studioRoot, "src-tauri", "target", "debug", "ticketry-hook"), hook);

  writeFileSync(path.join(dataDirectory, "approved-executables.json"), JSON.stringify({
    tools: [
      { tool: "codex", path: codex },
      { tool: "tmux", path: tmux },
    ],
  }, null, 2));
  return { codex, dataDirectory, hook, marker };
}

async function createStoryThroughStudio(browser, workspaceDirectory) {
  const welcome = await browser.$('[data-testid="onboarding-welcome"]');
  await welcome.waitForDisplayed({ timeout: 60_000 });

  const codex = await browser.$("aria/I use codex");
  await click(codex);
  await click(await browser.$("aria/Get started"));

  await click(await browser.$("aria/+ Add Module"));
  await click(await browser.$("aria/Next"));
  await click(await browser.$("aria/Got it"));
  const moduleName = await browser.$('input[placeholder="Module name"]');
  await moduleName.setValue("Acceptance Module");
  await (await browser.$("aria/Module folder")).setValue(workspaceDirectory);
  await click(await browser.$("aria/Create module"));

  const skipTour = await browser.$('[data-testid="onboarding-skip-tour"]');
  await click(skipTour);

  const taskId = await captureIdea(browser, "Prove desktop agent execution");
  await openExistingStory(browser, taskId);
  return {
    launch: await browser.$("aria/Run agent"),
    taskId,
  };
}

function tmuxInventory(root) {
  const result = spawnSync(tmux, [
    "-L",
    "ticketry-e2e",
    "list-sessions",
    "-F",
    "#{session_name}|#{@pt-agent-run-id}|#{pane_dead}|#{pane_dead_status}|#{pane_current_command}|#{pane_start_command}",
  ], {
    env: { ...process.env, TMUX_TMPDIR: path.join(root, "tmux") },
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : "<no private tmux sessions>\n";
}

function tmuxCapture(root) {
  const result = spawnSync(tmux, [
    "-L",
    "ticketry-e2e",
    "capture-pane",
    "-p",
    "-S",
    "-",
  ], {
    env: { ...process.env, TMUX_TMPDIR: path.join(root, "tmux") },
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : "<no private tmux pane output>\n";
}

async function waitForTmuxEmpty(root, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tmuxInventory(root).includes("<no private tmux sessions>")) {
      // The runtime settles its durable cleanup effect immediately after tmux
      // confirms absence. Let that same reconciliation pass commit first.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`private tmux did not become empty: ${tmuxInventory(root).trim()}`);
}

async function waitForState(browser, state) {
  const picker = await browser.$('[data-testid="state-picker"]');
  await picker.waitUntil(async () => (await picker.getText()).includes(state), {
    timeout: 30_000,
    timeoutMsg: `ticket did not visibly move to ${state}`,
  });
}

/**
 * CODING-1486 — native libghostty reads its configuration and pinned runtime
 * resources through NSBundle, which for an unbundled executable resolves to the
 * directory holding it. This harness runs a copy of the built binary from a
 * temporary directory, so the resources have to travel with it; without them
 * native initialization fails and the shell silently renders with xterm.
 */
function stageNativeGhosttyResources(applicationDirectory) {
  copyFileSync(
    path.join(studioRoot, "src-tauri", "native", "ticketry-ghostty.conf"),
    path.join(applicationDirectory, "ticketry-ghostty.conf"),
  );
  const resources = path.join(studioRoot, "src-tauri", "vendor", "libghostty", "resources");
  for (const resource of ["ghostty", "terminfo"]) {
    cpSync(
      path.join(resources, resource),
      path.join(applicationDirectory, resource),
      { recursive: true },
    );
  }
}

/**
 * CODING-1486 — a packaged desktop build renders its terminals with embedded
 * native libghostty, with no build flag, URL parameter, or stored setting.
 *
 * This checks the running artifact rather than a source constant: the native
 * host must be mounted and no fallback notice may be showing. It also proves
 * the run's bytes are not crossing into the WebView: a native run mounts no
 * streamed viewer, so the compatibility renderer's xterm screen must not exist
 * alongside it.
 */
async function assertNativeRendererOwnsTheRun(browser) {
  const nativeHost = await browser.$('[data-testid="native-terminal-host"]');
  await nativeHost.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: "the packaged build did not mount the native libghostty host",
  });
  for (const [selector, complaint] of [
    ['[data-testid="native-terminal-fallback-notice"]', "the packaged build reported a native renderer failure"],
    ['[data-testid="terminal-host"]', "a streamed xterm viewer is attached alongside the native viewer"],
  ]) {
    if (await (await browser.$(selector)).isExisting().catch(() => false)) {
      throw new Error(complaint);
    }
  }
}

async function main() {
  if (!tmux) {
    throw new Error(
      "tmux is unavailable; install it or set TICKETRY_DESKTOP_ACCEPTANCE_TMUX",
    );
  }
  if (process.env.TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD !== "1") {
    // CODING-1486 — the acceptance shell renders with native libghostty, a
    // default Cargo feature, so the pinned static library must exist first.
    run("npm", ["run", "libghostty:prepare"], { cwd: studioRoot });
    run("npm", [
      "exec",
      "tauri",
      "build",
      "--",
      "--debug",
      "--no-bundle",
      "--features",
      "desktop-acceptance",
    ], { cwd: studioRoot });
  }

  const root = mkdtempSync("/private/tmp/ticketry-desktop-e2e-");
  const artifacts = path.join(root, "artifacts");
  const applicationDirectory = path.join(root, "app");
  const workspaceDirectory = path.join(root, "workspace");
  const tmuxDirectory = path.join(root, "tmux");
  const runtimeTempDirectory = path.join(root, "runtime-temp");
  const stdout = [];
  const stderr = [];
  let tools;
  let child;
  let browser;
  const mcpBlockers = [];
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    if (browser) await browser.deleteSession().catch(() => {});
    await stopProcess(child);
    await Promise.all(mcpBlockers.map((server) => closeServer(server).catch(() => {})));
    spawnSync(tmux, ["-L", "ticketry-e2e", "kill-server"], {
      env: { ...process.env, TMUX_TMPDIR: tmuxDirectory },
      stdio: "ignore",
    });
    rmSync(root, { recursive: true, force: true });
  })();
  const handleSignal = (signal) => {
    void cleanup().finally(() => process.kill(process.pid, signal));
  };
  const handleInterrupt = () => handleSignal("SIGINT");
  const handleTermination = () => handleSignal("SIGTERM");
  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleTermination);
  try {
    mkdirSync(artifacts);
    mkdirSync(applicationDirectory);
    mkdirSync(workspaceDirectory);
    mkdirSync(tmuxDirectory);
    mkdirSync(runtimeTempDirectory);
    const binary = path.join(applicationDirectory, "ticketry");
    const hook = path.join(applicationDirectory, "ticketry-hook");
    copyFileSync(builtBinary, binary);
    tools = provisionDisposableTools(root);
    copyFileSync(tools.hook, hook);
    chmodSync(binary, 0o755);
    chmodSync(hook, 0o755);
    stageNativeGhosttyResources(applicationDirectory);
    let port = await availablePort();
    const applicationEnvironment = {
      MUXED_DATA_DIR: tools.dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: "ticketry-e2e",
      TMUX_TMPDIR: tmuxDirectory,
      TMPDIR: runtimeTempDirectory,
      MUXED_OUTPUT_SWEEP_SECONDS: "1",
      MUXED_DEVELOPMENT_LOG_PATH: path.join(artifacts, "ticketry.log"),
    };
    for (const obsoletePort of obsoleteMcpPorts) {
      try {
        mcpBlockers.push(await occupyPort(obsoletePort));
      } catch (error) {
        if (error?.code !== "EADDRINUSE") throw error;
      }
    }
    child = spawnTicketry(binary, {
      ...applicationEnvironment,
      TAURI_WEBDRIVER_PORT: String(port),
      TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS: "250",
    }, stdout, stderr);
    browser = await connectToStudio(port, child);
    await waitForMcpPing(tools.dataDirectory, child);
    for (const obsoletePort of obsoleteMcpPorts) {
      if (!await portIsOccupied(obsoletePort)) {
        throw new Error(`Port ${obsoletePort} stopped being occupied during desktop startup`);
      }
    }
    const story = await createStoryThroughStudio(browser, workspaceDirectory);
    await waitForState(browser, "Ideas");
    // CODING-1528: prove the description seam in WebKit before any run exists.
    if (!process.argv.includes("--mcp-recovery")) {
      await proveDescriptionSaveAndStorySwitch(browser, story.taskId);
    }
    await openExistingStory(browser, story.taskId);
    story.launch = await browser.$("aria/Run agent");
    writeFileSync(path.join(root, "provider-task"), `${story.taskId}\nCoding\n`);
    if (!existsSync(tools.marker)) {
      await click(story.launch);
      const toast = await browser.$(
        '//*[@data-testid and starts-with(@data-testid,"toast-") and contains(.,"Agent run")]',
      );
      await toast.waitForDisplayed({ timeout: 20_000 });
      const launchResult = await toast.getText();
      if (!launchResult.includes("Agent run started.")) {
        throw new Error(`Run agent failed through the visible UI: ${launchResult}`);
      }
    }
    const deadline = Date.now() + 20_000;
    while (!existsSync(tools.marker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!existsSync(tools.marker)) {
      throw new Error("the disposable provider did not start");
    }
    const provider = JSON.parse(readFileSync(tools.marker, "utf8"));
    if (provider.task_id !== story.taskId || provider.cwd !== workspaceDirectory) {
      throw new Error("the disposable provider did not receive Ticketry's task and CWD");
    }
    if (provider.mcp_data_directory !== tools.dataDirectory || provider.mcp_authorization !== true) {
      throw new Error("the disposable provider did not receive Ticketry's data-directory MCP authority");
    }
    const inventory = tmuxInventory(root);
    if (inventory.includes("<no private tmux sessions>") || !inventory.includes("|0|")) {
      throw new Error(`the disposable provider is not live in private tmux: ${inventory.trim()}`);
    }

    const activeBadge = await browser.$(
      `[data-task-id="${story.taskId}"] [data-testid="agent-state-badge"][data-state="active"]`,
    );
    await activeBadge.waitForDisplayed({ timeout: 30_000 });
    const moduleTab = await browser.$('button[role="tab"][aria-label="Acceptance Module"]');
    const moduleActivity = await moduleTab.$('[aria-label="Agent is actively working"]');
    await moduleActivity.waitForDisplayed({ timeout: 30_000 });
    const terminalTab = await browser.$("aria/Ideas codex terminal");
    await terminalTab.waitForDisplayed({ timeout: 30_000 });
    await (await terminalTab.$("aria/Agent is actively working"))
      .waitForDisplayed({ timeout: 30_000 });
    if (!process.argv.includes("--mcp-recovery")) {
      await assertNativeRendererOwnsTheRun(browser);
    }

    ({ child, browser } = await verifyLiveMcpRecovery({
      root, dataDirectory: tools.dataDirectory, child, browser,
      inventory: () => tmuxInventory(root),
      restart: async () => {
        port = await availablePort();
        child = spawnTicketry(binary, {
          ...applicationEnvironment,
          TAURI_WEBDRIVER_PORT: String(port),
          TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS: "250",
        }, stdout, stderr);
        browser = await connectToStudio(port, child);
        await waitForMcpPing(tools.dataDirectory, child);
        await openExistingStory(browser, story.taskId);
        return { child, browser };
      },
    }));

    for (const state of ["Implement", "Review", "Done"]) {
      writeFileSync(path.join(root, `advance-${state}`), "");
      await waitForState(browser, state);
    }

    writeFileSync(path.join(root, "provider-exit"), "");
    const completedRun = await browser.$("aria/Resume Ideas codex terminal");
    await completedRun.waitForDisplayed({ timeout: 30_000 });
    if (process.argv.includes("--mcp-recovery")) {
      const hooks = readFileSync(path.join(root, "provider-hooks.log"), "utf8");
      for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]) {
        if (!hooks.includes(event)) throw new Error(`Missing provider hook ${event}`);
      }
      for (const mode of ["orderly", "sigkill"]) {
        const evidence = JSON.parse(readFileSync(path.join(root, `recovery-${mode}.json`), "utf8"));
        console.log(`${mode} MCP recovery passed; outage error in ${evidence.outage_ms.toFixed(2)} ms`);
      }
      console.log("Ticketry desktop MCP recovery acceptance passed (Codex fixture).");
      return;
    }
    await browser.waitUntil(async () =>
      !(await (await browser.$('button[role="tab"][aria-label="Acceptance Module"] [aria-label="Agent is actively working"]')).isDisplayed().catch(() => false)), {
      timeout: 30_000,
      timeoutMsg: "the module lifecycle badge did not clear after completion",
    });

    if (!await (await browser.$('[data-testid="terminal-panel"]'))
      .isDisplayed().catch(() => false)) {
      await click(await browser.$("aria/Open terminal panel"));
    }
    await (await browser.$("aria/Shell 1")).waitForDisplayed({ timeout: 20_000 });
    await click(await browser.$("aria/Close shell 1"));
    await browser.waitUntil(async () =>
      !await (await browser.$("aria/Shell 1")).isDisplayed().catch(() => false), {
      timeout: 20_000,
      timeoutMsg: "the closed module shell tab remained visible",
    });
    // Closing the shell replaces the panel header. Resolve the minimize
    // control afterward so WebDriver cannot silently keep a stale element and
    // leave the panel persisted open for the restart check.
    await click(await browser.$("aria/Minimize terminal panel"));
    await (await browser.$("aria/Open terminal panel"))
      .waitForDisplayed({ timeout: 20_000 });
    // Panel visibility is intentionally debounced for local persistence. Let
    // that write settle before reloading or the new webview restores it open
    // and creates a fresh shell during the restart assertion.
    await new Promise((resolve) => setTimeout(resolve, 500));

    await browser.refresh();
    await openExistingStory(browser, story.taskId);
    await waitForState(browser, "Done");
    await (await browser.$("aria/Resume Ideas codex terminal")).waitForDisplayed({ timeout: 30_000 });
    await waitForTmuxEmpty(root);

    await browser.deleteSession();
    browser = undefined;
    await stopProcess(child);

    port = await availablePort();
    child = spawnTicketry(binary, {
      ...applicationEnvironment,
      TAURI_WEBDRIVER_PORT: String(port),
      TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS: "1000",
    }, stdout, stderr);
    browser = await connectToStudio(port, child);
    await openExistingStory(browser, story.taskId);
    await waitForState(browser, "Done");
    await (await browser.$("aria/Resume Ideas codex terminal")).waitForDisplayed({ timeout: 30_000 });

    await browser.deleteSession();
    browser = undefined;
    await stopProcess(child);
    const hookEvidence = readFileSync(path.join(root, "provider-hooks.log"), "utf8");
    for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]) {
      if (!hookEvidence.includes(event)) {
        throw new Error(`the disposable provider did not report ${event} through the hook runner`);
      }
    }
    const mcpEvidence = readFileSync(path.join(root, "provider-mcp.log"), "utf8");
    if (!mcpEvidence.includes('"ok":true')) {
      throw new Error("the disposable provider did not report through Ticketry's rotated MCP endpoint");
    }
    const finalInventory = tmuxInventory(root);
    if (!finalInventory.includes("<no private tmux sessions>")) {
      throw new Error(`private tmux sessions leaked after completion: ${finalInventory.trim()}`);
    }
    console.log("Ticketry desktop agent acceptance passed.");
  } catch (error) {
    if (browser) {
      await browser.saveScreenshot(path.join(artifacts, "failure.png")).catch(() => {});
      const diagnostic = await browser.execute(() => ({
        body: document.body?.innerText ?? "",
        html: document.documentElement?.outerHTML ?? "",
        href: window.location.href,
        readyState: document.readyState,
        consoleErrors: window.__ticketryAcceptanceDiagnostics ?? [],
      })).catch((cause) => ({ diagnosticError: String(cause) }));
      writeFileSync(
        path.join(artifacts, "frontend-diagnostic.json"),
        JSON.stringify(diagnostic, null, 2),
      );
    }
    const readiness = path.join(tools?.dataDirectory ?? root, "slice2-readiness.json");
    if (existsSync(readiness)) copyFileSync(readiness, path.join(artifacts, "slice2-readiness.json"));
    writeFileSync(path.join(artifacts, "ticketry.stdout.log"), Buffer.concat(stdout));
    writeFileSync(path.join(artifacts, "ticketry.stderr.log"), Buffer.concat(stderr));
    writeFileSync(path.join(artifacts, "tmux-inventory.txt"), tmuxInventory(root));
    writeFileSync(path.join(artifacts, "provider-output.log"), tmuxCapture(root));
    for (const evidence of ["provider-error.log", "provider-hooks.log", "provider-mcp.log", "provider-prompt.log", "provider-started.json", "recovery-orderly.json", "recovery-sigkill.json"]) {
      const source = path.join(root, evidence);
      if (existsSync(source)) copyFileSync(source, path.join(artifacts, evidence));
    }
    const retainedArtifacts = path.join(
      studioRoot,
      "test-results",
      `desktop-agent-acceptance-${Date.now()}`,
    );
    cpSync(artifacts, retainedArtifacts, { recursive: true });
    console.error(`Desktop acceptance failed. Artifacts: ${retainedArtifacts}`);
    throw error;
  } finally {
    process.off("SIGINT", handleInterrupt);
    process.off("SIGTERM", handleTermination);
    await cleanup();
  }
}

await main();
