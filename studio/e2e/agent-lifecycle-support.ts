import { expect, type APIRequestContext } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LiveRunStatusPreloadDocument } from "../src/features/agents/status/generated/statusStream.documents";
import { TaskResumableTerminalSessionsDocument, UpdateTerminalSessionDocument } from "../src/features/agents/terminal/generated/terminalSessions.documents";
import { graphql } from "./support";

export async function prepareAgentProvider(mode: "success" | "failure" = "success", states: string[] = [], suppressReady = false) {
  await writeFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, "agent-control.json"), JSON.stringify({ mode, states, suppressReady }));
}
export async function agentStatus(request: APIRequestContext, projectId: string) {
  return graphql(request, LiveRunStatusPreloadDocument, { projectId });
}
export async function waitForAgent(request: APIRequestContext, projectId: string, taskId: string) {
  await expect.poll(async () => (await agentStatus(request, projectId)).agent_run_holdings.find(run => run.task_id === taskId)?.effective_state).toBe("working");
  return (await agentStatus(request, projectId)).agent_run_holdings.find(run => run.task_id === taskId)!;
}

export async function terminateAgent(request: APIRequestContext, runId: string) {
  await graphql(request, UpdateTerminalSessionDocument, { agentRunId: runId, terminationRequestId: crypto.randomUUID() });
}

export async function waitForAgentExit(request: APIRequestContext, taskId: string, runId: string) {
  await expect.poll(async () => (await graphql(request, TaskResumableTerminalSessionsDocument, { taskId })).resumable_sessions.find(run => run.agent_run_id === runId)?.ended_at != null, { timeout: 25_000 }).toBe(true);
  const marker = JSON.parse(await readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, `${runId}.interactive.json`), "utf8")) as { pid: number };
  await expect.poll(() => { try { process.kill(marker.pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } }, { timeout: 25_000 }).toBe(false);
}
