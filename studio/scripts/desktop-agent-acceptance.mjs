import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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

import { remote } from "webdriverio";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(studioRoot, "..");
const builtBinary = process.env.TICKETRY_DESKTOP_ACCEPTANCE_BINARY
  ?? path.join(studioRoot, "src-tauri", "target", "debug", "ticketry");
const tmux = process.env.TICKETRY_DESKTOP_ACCEPTANCE_TMUX
  ?? ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find(existsSync);
const mcpPort = 8123;
const rotatedMcpPort = 8124;
const rotatedMcpUrl = `http://127.0.0.1:${rotatedMcpPort}/mcp`;

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

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
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

async function waitForPort(port, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ticketry exited before WebDriver started (${child.exitCode})`);
    }
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`WebDriver did not listen on port ${port}`);
}

async function waitForMcpPing(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Ticketry exited before its MCP listener became ready (${child.exitCode})`);
    }
    const controller = new AbortController();
    const attemptTimeout = setTimeout(
      () => controller.abort(),
      Math.min(1_000, deadline - Date.now()),
    );
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-03-26",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "desktop-port-rotation",
          method: "tools/call",
          params: { name: "mcp_ping", arguments: {} },
        }),
      });
      const payload = await response.json();
      if (
        payload?.result?.structuredContent?.status === "ok"
        && payload.result.structuredContent.server === "worktracker-agent"
      ) {
        return;
      }
    } catch {
      // The desktop can become WebDriver-ready just before its MCP listener.
    } finally {
      clearTimeout(attemptTimeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Ticketry MCP did not answer at the selected endpoint ${url}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killed = once(child, "exit");
  child.kill("SIGKILL");
  await killed;
}

function spawnTicketry(binary, environment, stdout, stderr) {
  const childEnvironment = { ...process.env, ...environment };
  if (!Object.hasOwn(environment, "MUXED_DESKTOP_MCP_PORT")) {
    delete childEnvironment.MUXED_DESKTOP_MCP_PORT;
  }
  const child = spawn(binary, [], {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return child;
}

async function connectToStudio(port, child) {
  await waitForPort(port, child);
  const browser = await remote({
    hostname: "127.0.0.1",
    port,
    logLevel: "warn",
    capabilities: {
      "wdio:tauriServiceOptions": { windowLabel: "main" },
    },
  });
  if (await browser.getUrl() === "about:blank") {
    await browser.url("tauri://localhost/");
  }
  await browser.waitUntil(async () =>
    await browser.execute(() => document.readyState === "complete"), {
    timeout: 20_000,
    timeoutMsg: "the embedded Studio document did not finish loading",
  });
  await browser.execute(() => {
    const messages = [];
    window.__ticketryAcceptanceDiagnostics = messages;
    window.addEventListener("error", (event) => {
      messages.push({ type: "error", message: event.message });
    });
    window.addEventListener("unhandledrejection", (event) => {
      messages.push({ type: "unhandledrejection", message: String(event.reason) });
    });
    const original = console.error.bind(console);
    console.error = (...values) => {
      messages.push({ type: "console.error", message: values.map(String).join(" ") });
      original(...values);
    };
  });
  return browser;
}

function provisionDisposableTools(root) {
  const toolDirectory = path.join(root, "bin");
  const dataDirectory = path.join(root, "data");
  const marker = path.join(root, "provider-started.json");
  mkdirSync(toolDirectory, { recursive: true });
  mkdirSync(dataDirectory, { recursive: true });

  const codex = path.join(toolDirectory, "codex");
  writeFileSync(codex, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'codex-cli 0.0.0-ticketry-acceptance\\n'
  exit 0
fi
acceptance_root=${JSON.stringify(root)}
hook_settings=""
mcp_settings=""
prompt=""
for argument in "$@"; do
  case "$argument" in
    hooks=*) hook_settings="$argument" ;;
    mcp_servers=*) mcp_settings="$argument" ;;
  esac
  prompt="$argument"
done

hook_command=$(printf '%s\\n' "$hook_settings" | /usr/bin/sed -n 's/.*command="\\([^"]*\\)".*/\\1/p')
mcp_url=$(printf '%s\\n' "$mcp_settings" | /usr/bin/sed -n 's/.*url="\\([^"]*\\)".*/\\1/p')
mcp_authorization=$(printf '%s\\n' "$mcp_settings" | /usr/bin/sed -n 's/.*Authorization="\\([^"]*\\)".*/\\1/p')
project_id=$(printf '%s\\n' "$prompt" | /usr/bin/sed -n 's/^Project ID: //p' | /usr/bin/sed -n '1p')
task_id=$(printf '%s\\n' "$prompt" | /usr/bin/sed -n 's/^Work Item ID: //p' | /usr/bin/sed -n '1p')
if [ -f "$acceptance_root/provider-task" ]; then
  [ -n "$task_id" ] || task_id=$(/usr/bin/sed -n '1p' "$acceptance_root/provider-task")
  [ -n "$project_id" ] || project_id=$(/usr/bin/sed -n '2p' "$acceptance_root/provider-task")
fi

if [ -z "$hook_command" ] || [ -z "$mcp_url" ] || [ -z "$mcp_authorization" ] || [ -z "$project_id" ] || [ -z "$task_id" ]; then
  printf '%s\\n' "$prompt" > "$acceptance_root/provider-prompt.log"
  printf 'Ticketry acceptance launch material was incomplete: hook=%s url=%s authorization=%s project=%s task=%s\\n' \
    "$([ -n "$hook_command" ] && printf present || printf missing)" \
    "$([ -n "$mcp_url" ] && printf present || printf missing)" \
    "$([ -n "$mcp_authorization" ] && printf present || printf missing)" \
    "$([ -n "$project_id" ] && printf present || printf missing)" \
    "$([ -n "$task_id" ] && printf present || printf missing)" > "$acceptance_root/provider-error.log"
  exit 64
fi

emit_hook() {
  printf '{"hook_event_name":"%s","session_id":"ticketry-acceptance-provider"}' "$1" \
    | /bin/sh -c "$hook_command" || exit 68
  printf '%s\n' "$1" >> "$acceptance_root/provider-hooks.log"
}

move_task() {
  state="$1"
  request=$(printf '{"jsonrpc":"2.0","id":"desktop-acceptance","method":"tools/call","params":{"name":"update_task_status","arguments":{"project_id":"%s","task_id":"%s","status_name":"%s"}}}' "$project_id" "$task_id" "$state")
  response=$(/usr/bin/curl --silent --show-error --fail \
    --header 'content-type: application/json' \
    --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-03-26' \
    --header "authorization: $mcp_authorization" \
    --data "$request" "$mcp_url") || exit 65
  printf '%s\\n' "$response" >> "$acceptance_root/provider-mcp.log"
  case "$response" in
    *'"ok":true'*) ;;
    *) printf 'Ticketry MCP refused state %s\\n' "$state" > "$acceptance_root/provider-error.log"; exit 66 ;;
  esac
}

wait_for_signal() {
  signal="$1"
  attempts=0
  while [ ! -f "$acceptance_root/$signal" ] && [ "$attempts" -lt 240 ]; do
    sleep 0.25
    attempts=$((attempts + 1))
  done
  [ -f "$acceptance_root/$signal" ] || exit 67
}

printf '{"pid":%s,"cwd":"%s","task_id":"%s","project_id":"%s","hook":true,"mcp_url":"%s","mcp_authorization":true}\\n' \
  "$$" "$PWD" "$task_id" "$project_id" "$mcp_url" > ${JSON.stringify(marker)}
printf 'Ticketry desktop acceptance provider started\\n'
emit_hook SessionStart
emit_hook UserPromptSubmit

for state in Implement Review Done; do
  wait_for_signal "advance-$state"
  printf 'Ticketry provider moving ticket to %s\\n' "$state"
  move_task "$state"
  emit_hook PostToolUse
done

wait_for_signal provider-exit
emit_hook Stop
printf 'Ticketry desktop acceptance provider completed\\n'
`, { mode: 0o755 });
  chmodSync(codex, 0o755);

  const hook = path.join(toolDirectory, "ticketry-hook");
  run("rustc", [
    path.join(studioRoot, "src-tauri", "native", "ticketry_hook.rs"),
    "-o",
    hook,
  ]);

  writeFileSync(path.join(dataDirectory, "approved-executables.json"), JSON.stringify({
    tools: [
      { tool: "codex", path: codex },
      { tool: "tmux", path: tmux },
    ],
  }, null, 2));
  return { codex, dataDirectory, hook, marker };
}

async function click(element) {
  await element.waitForDisplayed({ timeout: 20_000 });
  await element.click();
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

  const idea = await browser.$("aria/Capture an idea");
  await idea.waitForDisplayed({ timeout: 20_000 });
  await idea.setValue("Prove desktop agent execution");
  await browser.keys("Enter");
  const storySelector =
    '//li[@role="treeitem"][.//*[@data-task-name="true" and normalize-space()="Prove desktop agent execution"]]';
  let taskId;
  await browser.waitUntil(async () => {
    const story = await browser.$(storySelector);
    if (!await story.isDisplayed().catch(() => false)) return false;
    const candidate = await story.getAttribute("data-task-id");
    if (!candidate || candidate.startsWith("optimistic:")) return false;
    taskId = candidate;
    return true;
  }, {
    interval: 100,
    timeout: 20_000,
    timeoutMsg: "the created Story did not receive its persisted identity",
  });
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

async function openExistingStory(browser, taskId) {
  await browser.waitUntil(async () => {
    const story = await browser.$(`[data-task-id="${taskId}"]`);
    if (!await story.isDisplayed().catch(() => false)) return false;
    await story.click().catch(() => {});
    return await (await browser.$('[data-testid="issue-name"]'))
      .isDisplayed()
      .catch(() => false);
  }, {
    interval: 250,
    timeout: 30_000,
    timeoutMsg: `Story ${taskId} did not open in the details surface`,
  });
}

async function main() {
  if (!tmux) {
    throw new Error(
      "tmux is unavailable; install it or set TICKETRY_DESKTOP_ACCEPTANCE_TMUX",
    );
  }
  if (process.env.TICKETRY_DESKTOP_ACCEPTANCE_SKIP_BUILD !== "1") {
    run("npm", [
      "exec",
      "tauri",
      "build",
      "--",
      "--debug",
      "--no-bundle",
      "--features",
      "native-libghostty,desktop-acceptance",
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
  let mcpBlocker;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    if (browser) await browser.deleteSession().catch(() => {});
    await stopProcess(child);
    await closeServer(mcpBlocker).catch(() => {});
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
    tools = provisionDisposableTools(root);
    const binary = path.join(applicationDirectory, "ticketry");
    const hook = path.join(applicationDirectory, "ticketry-hook");
    copyFileSync(builtBinary, binary);
    copyFileSync(tools.hook, hook);
    chmodSync(binary, 0o755);
    chmodSync(hook, 0o755);
    let port = await availablePort();
    const applicationEnvironment = {
      MUXED_DATA_DIR: tools.dataDirectory,
      MUXED_FORCE_SQLITE: "true",
      MUXED_TMUX_SOCKET: "ticketry-e2e",
      TMUX_TMPDIR: tmuxDirectory,
      TMPDIR: runtimeTempDirectory,
      MUXED_OUTPUT_SWEEP_SECONDS: "1",
    };
    const nextPortReservation = await occupyPort(rotatedMcpPort);
    await closeServer(nextPortReservation);
    try {
      mcpBlocker = await occupyPort(mcpPort);
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
    child = spawnTicketry(binary, {
      ...applicationEnvironment,
      TAURI_WEBDRIVER_PORT: String(port),
      TICKETRY_DESKTOP_ACCEPTANCE_SWEEP_MILLIS: "250",
    }, stdout, stderr);
    browser = await connectToStudio(port, child);
    await waitForMcpPing(rotatedMcpUrl, child);
    if (!(mcpBlocker?.listening || await portIsOccupied(mcpPort))) {
      throw new Error(
        `the port ${mcpPort} reservation ended before desktop startup completed`,
      );
    }
    const story = await createStoryThroughStudio(browser, workspaceDirectory);
    await waitForState(browser, "Ideas");
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
    if (provider.mcp_url !== rotatedMcpUrl || provider.mcp_authorization !== true) {
      throw new Error("the disposable provider did not receive Ticketry's rotated MCP authority");
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

    for (const state of ["Implement", "Review", "Done"]) {
      writeFileSync(path.join(root, `advance-${state}`), "");
      await waitForState(browser, state);
    }

    writeFileSync(path.join(root, "provider-exit"), "");
    const completedRun = await browser.$("aria/Resume Ideas codex terminal");
    await completedRun.waitForDisplayed({ timeout: 30_000 });
    await browser.waitUntil(async () =>
      !(await moduleActivity.isDisplayed().catch(() => false)), {
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
    writeFileSync(path.join(artifacts, "ticketry.stdout.log"), Buffer.concat(stdout));
    writeFileSync(path.join(artifacts, "ticketry.stderr.log"), Buffer.concat(stderr));
    writeFileSync(path.join(artifacts, "tmux-inventory.txt"), tmuxInventory(root));
    writeFileSync(path.join(artifacts, "provider-output.log"), tmuxCapture(root));
    for (const evidence of ["provider-error.log", "provider-hooks.log", "provider-mcp.log", "provider-prompt.log", "provider-started.json"]) {
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
