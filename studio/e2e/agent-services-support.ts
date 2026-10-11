import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { fixtureLaunchEvidence } from "./agent-launch-support";
import { agentStatus } from "./agent-lifecycle-support";
import { observeConversationLaunch } from "./conversation-support";
import { openWorkItem } from "./support";
import { names, openFeatureModule } from "./work-items-migration-support";

/** Accessible titles the lifecycle chip publishes for each durable run state. */
export const lifecycleChip = {
  working: "Agent is actively working",
  needsInput: "Agent is waiting for your input",
  permission: "A permission decision is pending",
  turnComplete: "Agent finished its turn and is awaiting you",
} as const;

type ToolCall = { name: string; arguments: Record<string, unknown> };
export type FixtureControl = {
  mode: "success" | "failure";
  hooks?: string[];
  startCalls?: ToolCall[];
  calls?: ToolCall[];
  states?: string[];
};

const providerDirectory = () => process.env.TICKETRY_E2E_PROVIDER_DIR!;
export const e2eDataDirectory = () => {
  const directory = process.env.TICKETRY_E2E_DATA_DIR;
  if (!directory) throw new Error("E2E data directory was not configured");
  return directory;
};

/** Launch one work item through Run item with the disposable provider's control. */
export async function launchFixtureRun(page: Page, itemName: string, control: FixtureControl): Promise<string> {
  await writeFile(join(providerDirectory(), "agent-control.json"), JSON.stringify(control));
  await openFeatureModule(page, names.module);
  await openWorkItem(page, itemName);
  const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
  await fixtureLaunchEvidence(launch.runId);
  return launch.runId;
}

export function rowBadge(page: Page, itemName: string) {
  return page.getByRole("treeitem", { name: new RegExp(itemName) }).getByTestId("agent-state-badge");
}

export async function runHolding(request: APIRequestContext, projectId: string, runId: string) {
  return (await agentStatus(request, projectId)).agent_run_holdings.find(run => run.agent_run_id === runId);
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/** Send one handshake envelope to the isolated socket and return its verdict line. */
export function mcpHandshake(envelope: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(join(e2eDataDirectory(), "mcp.sock"));
    let buffer = "";
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("MCP handshake timed out")); }, 5_000);
    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("connect", () => socket.write(`${JSON.stringify(envelope)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.destroy();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
  });
}

/** Structured tool results the fixture provider recorded through its run-scoped bridge. */
export async function fixtureBridgeCalls(runId: string, count: number): Promise<Array<{ name: string; result: Record<string, unknown> }>> {
  const path = join(providerDirectory(), `${runId}.calls.log`);
  let lines: string[] = [];
  await expect(async () => {
    lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(count);
  }).toPass({ timeout: 15_000 });
  return lines.map((line) => {
    const { name, response } = JSON.parse(line) as { name: string; response: { result?: { structuredContent?: Record<string, unknown> } } };
    expect(response.result?.structuredContent, line).toBeTruthy();
    return { name, result: response.result!.structuredContent! };
  });
}

export type LaunchHook = { command: string; executable: string; provider: string; runId: string; spoolDirectory: string };

/** The production lifecycle hook command a launch handed to the provider. */
export async function launchHook(runId: string): Promise<LaunchHook> {
  const { args } = await fixtureLaunchEvidence(runId);
  const hooks = args.find((value) => value.startsWith("hooks=")) ?? "";
  const quoted = hooks.match(/command=("(?:[^"\\]|\\.)*")/);
  expect(quoted, hooks).toBeTruthy();
  const command = JSON.parse(quoted![1]) as string;
  const words = [...command.matchAll(/'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2]);
  const option = (name: string) => words[words.indexOf(name) + 1];
  return {
    command,
    executable: words[0],
    provider: words[words.indexOf("hook") + 1],
    runId: option("--agent-run-id"),
    spoolDirectory: option("--spool-dir"),
  };
}

/** Publish one payload exactly as a provider would: pipe it to the hook command. */
export function publishHook(command: string, payload: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("/bin/sh", ["-c", command], { input: payload, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export const hookEvent = (event: string) => JSON.stringify({ hook_event_name: event, session_id: "hook-suite-session" });

export async function spoolEntries(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

/** Complete deliveries leave the spool once the periodic drain consumes them. */
export async function expectSpoolDrained(directory: string) {
  await expect.poll(async () => (await spoolEntries(directory)).filter(name => name.endsWith(".hook") || name.endsWith(".tmp")), { timeout: 10_000 }).toEqual([]);
}

/** Run the packaged bridge once and report how it exits (used for refused modes). */
export function runBridge(executable: string, args: string[], environment: Record<string, string> = {}) {
  const result = spawnSync(executable, args, { input: "", encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH!, ...environment } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Send initialize through the packaged bridge and return its first reply. */
export function bridgeInitialize(executable: string, args: string[], environment: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: { PATH: process.env.PATH!, ...environment } });
    let buffer = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Bridge initialize timed out")); }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      child.kill();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    child.on("error", reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ticketry-feature-suite", version: "1" },
    } })}\n`);
  });
}
