import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { availablePort, connectToStudio, defaultDesktopBinary, spawnTicketry, stopProcess } from "./desktop-webdriver-session.mjs";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(studioRoot, "..");
if (!process.argv.includes("--skip-build")) {
  // This case exercises the desktop lifecycle and WKWebView HTTP transport.
  // The supported xterm fallback keeps the unrelated native terminal library
  // out of this test build; shipping features are unchanged.
  const built = spawnSync("cargo", ["build", "--offline", "--manifest-path", "studio/src-tauri/Cargo.toml", "--bin", "ticketry", "--no-default-features", "--features", "desktop-acceptance"], { cwd: repositoryRoot, stdio: "inherit", env: { ...process.env, TAURI_CONFIG: JSON.stringify({ build: { devUrl: null }, bundle: { resources: [] } }) } });
  assert.equal(built.status, 0, "build the planner desktop acceptance binary");
}

const root = mkdtempSync("/private/tmp/ticketry-planner-acceptance-");
const directory = path.join(root, "configured-live-profile");
mkdirSync(directory);
mkdirSync(path.join(root, "tmux"));
let child;
let browser;
let blocker;
const stdout = [];
const stderr = [];

async function native(query, variables = {}) {
  const response = await browser.executeAsync((request, done) => {
    window.__TAURI_INTERNALS__.invoke("TauRPC__graphql_execute", { request_json: JSON.stringify(request) })
      .then((response) => done(JSON.parse(response)))
      .catch((error) => done({ transportError: String(error) }));
  }, { query, variables });
  assert.equal(response.transportError, undefined, "native GraphQL transport is available");
  assert.equal(response.errors, undefined, JSON.stringify(response.errors));
  return response.data;
}

async function configuration() {
  return browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("desktop_runtime_configuration")
      .then(done).catch((error) => done({ transportError: String(error) }));
  });
}

async function planner(query, variables = {}) {
  const metadata = await configuration();
  assert.ok(metadata.plannerEndpoint, "Ticketry publishes its live planner endpoint");
  const response = await browser.executeAsync((request, endpoint, done) => {
    fetch(endpoint.graphqlUrl, { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${endpoint.bearerToken}`,
    }, body: JSON.stringify(request) }).then(async (response) => done({ status: response.status, body: await response.json() }))
      .catch((error) => done({ transportError: String(error) }));
  }, { query, variables }, metadata.plannerEndpoint);
  assert.equal(response.transportError, undefined, "WKWebView can reach the planner endpoint");
  assert.equal(response.status, 200);
  assert.equal(response.body.errors, undefined, JSON.stringify(response.body.errors));
  return response.body.data;
}

async function start(extraEnvironment = {}, expectFailure = false) {
  const port = await availablePort();
  child = spawnTicketry(defaultDesktopBinary(), {
    MUXED_DATA_DIR: directory,
    MUXED_FORCE_SQLITE: "true",
    MUXED_TMUX_SOCKET: "ticketry-planner-acceptance",
    TMUX_TMPDIR: path.join(root, "tmux"),
    MUXED_DEVELOPMENT_LOG_PATH: path.join(root, "ticketry.log"),
    TAURI_WEBDRIVER_PORT: String(port),
    TICKETRY_PLANNER_PORT: "0",
    MUXED_DESKTOP_ORIGIN: "http://127.0.0.1:5176",
    ...extraEnvironment,
  }, stdout, stderr);
  browser = await connectToStudio(port, child);
  await browser.waitUntil(async () => {
    const current = await configuration();
    if (expectFailure) return current.serviceHealth?.state === "failed";
    if (current.serviceHealth?.state === "failed") throw new Error(current.serviceHealth.message);
    const readiness = path.join(directory, "slice2-readiness.json");
    return current.serviceHealth?.state === "ready" && current.plannerEndpoint
      && existsSync(readiness) && JSON.parse(readFileSync(readiness, "utf8")).ready;
  }, { timeout: 30_000, timeoutMsg: "Ticketry did not finish its planner startup" });
}

async function closeCleanly() {
  const exited = once(child, "exit");
  // WebDriver closes only this session's main window. Ticketry then executes
  // its normal RunEvent::Exit teardown before releasing directory ownership.
  // Send the close protocol directly. WebDriverIO's closeWindow hook tries
  // switching back to a window after Ticketry has exited.
  const response = await fetch(
    `http://127.0.0.1:${browser.options.port}/session/${encodeURIComponent(browser.sessionId)}/window`,
    { method: "DELETE" },
  );
  assert.equal(response.status, 200, "the desktop main window closes");
  await Promise.race([exited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Ticketry did not shut down cleanly")), 10_000);
    timer.unref();
  })]);
  assert.equal(child.exitCode, 0, "Ticketry clean exit");
  browser = undefined;
  child = undefined;
}

const read = `query($project: String!) {
  worktrackerProject(filters: {id: {eq: $project}}) { nodes { id name } }
  worktrackerSprint(filters: {projectId: {eq: $project}}) { nodes { id name status goals { nodes { id text position } } } }
  worktrackerIssue(filters: {projectId: {eq: $project}}) { nodes { id name sprintId stateRevision } }
}`;

try {
  await start();
  const firstEndpoint = (await configuration()).plannerEndpoint;
  assert.deepEqual((await configuration()).plannerEndpoint, firstEndpoint, "one listener per app instance");
  for (const origin of ["http://127.0.0.1:5176", "http://127.0.0.1:5175"]) {
    const allowed = origin.endsWith(":5176");
    const preflight = await fetch(firstEndpoint.graphqlUrl, { method: "OPTIONS", headers: {
      Origin: origin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    } });
    assert.equal(preflight.status, allowed ? 204 : 403);
    assert.equal(preflight.headers.get("access-control-allow-origin"), allowed ? origin : null);
    const response = await fetch(firstEndpoint.graphqlUrl, { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${firstEndpoint.bearerToken}`,
    }, body: JSON.stringify({ query: "{ __typename }" }) });
    assert.equal(response.status, allowed ? 200 : 403);
    if (allowed) assert.equal((await response.json()).errors, undefined);
  }
  const project = (await native('mutation { create_project(name: "Live planner", slug: "LIV") { id } }')).create_project.id;
  const variables = { project };
  assert.equal((await planner(read, variables)).worktrackerProject.nodes[0].name, "Live planner");
  const sprint = (await planner('mutation($project: String!) { worktrackerSprintCreateOne(data: {projectId: $project, name: "Desktop sprint"}) { id } }', variables)).worktrackerSprintCreateOne.id;
  const goal = (await native('mutation($sprint: String!) { create_sprint_goal(sprint_id: $sprint, text: "Shared storage") { id } }', { sprint })).create_sprint_goal.id;
  const type = (await native('query($project: String!) { worktrackerIssuetype(filters: {projectId: {eq: $project}, name: {eq: "Story"}}) { nodes { id } } }', variables)).worktrackerIssuetype.nodes[0].id;
  const story = (await native('mutation($project: String!, $type: String!) { create_work_item(project_id: $project, issue_type_id: $type, name: "Ticketry story") { id } }', { project, type })).create_work_item.id;
  await planner('mutation($story: String!, $sprint: String!) { update_work_item(id: $story, sprint_id: $sprint) { id } }', { story, sprint });
  await planner('mutation($goal: String!) { update_sprint_goal(id: $goal, text: "Edited through the planner") { id } }', { goal });
  const expected = await native(read, variables);
  assert.equal(expected.worktrackerIssue.nodes[0].sprintId, sprint);
  assert.equal(expected.worktrackerSprint.nodes[0].goals.nodes[0].text, "Edited through the planner");
  assert.deepEqual(await planner(read, variables), expected);
  await closeCleanly();
  await assert.rejects(fetch(firstEndpoint.graphqlUrl, { method: "POST", signal: AbortSignal.timeout(2_000) }), "the old listener closes with Ticketry");
  await start();
  assert.notEqual((await configuration()).plannerEndpoint.bearerToken, firstEndpoint.bearerToken);
  assert.deepEqual(await native(read, variables), expected);
  assert.deepEqual(await planner(read, variables), expected);
  assert.ok(existsSync(path.join(directory, "state.db")));
  for (const snapshot of ["planner.sqlite3", "planner.previous.sqlite3", "planner.sqlite3.lock"]) {
    assert.equal(existsSync(path.join(directory, snapshot)), false, `no ${snapshot} copy`);
  }
  await closeCleanly();

  blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once("error", reject); blocker.listen({ host: "127.0.0.1", port: 0 }, resolve); });
  const blockedPort = blocker.address().port;
  await start({ TICKETRY_PLANNER_PORT: String(blockedPort) }, true);
  const failed = await configuration();
  assert.equal(failed.plannerEndpoint, null);
  assert.ok(failed.serviceHealth.message.includes(`Ticketry planner could not bind 127.0.0.1:${blockedPort}`));
  await browser.waitUntil(async () => {
    const text = await browser.$("body").getText();
    return text.includes(`Ticketry planner could not bind 127.0.0.1:${blockedPort}`)
      && text.includes("quit and reopen Ticketry to retry startup")
      && text.includes(failed.serviceHealth.logPointer);
  }, { timeout: 10_000, timeoutMsg: "Planner failure guidance was not visible" });
  assert.equal(await browser.$("button=Retry").isExisting(), false, "restart-only runtime has no ineffective Retry");
  assert.equal(await browser.$('button[aria-label="Open Settings"]').isDisplayed(), true, "Settings remains reachable after bind failure");
  await closeCleanly();
  console.log("Planner desktop acceptance passed: shared live writes, WKWebView endpoint, restart persistence, clean shutdown, and bind failure.");
} catch (error) {
  writeFileSync(path.join(root, "stdout.log"), Buffer.concat(stdout));
  writeFileSync(path.join(root, "stderr.log"), Buffer.concat(stderr));
  console.error(`Planner desktop acceptance artifacts: ${root}`);
  throw error;
} finally {
  if (browser) await browser.deleteSession().catch(() => {});
  await stopProcess(child);
  if (blocker) await new Promise((resolve) => blocker.close(resolve));
  if (!existsSync(path.join(root, "stderr.log"))) rmSync(root, { recursive: true, force: true });
}
