import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { ScratchResumableTerminalSessionsDocument } from "../src/features/agents/terminal/generated/terminalSessions.documents";
import { InstantRunTicketsDocument } from "../src/features/agents/terminal/generated/instantRunTickets.documents";
import { configureCodexDefault, createModule, getWorkflowCatalog, getWorkspace, graphql, selectModuleForProfile } from "./support";

export async function createConversationModule(request: APIRequestContext) {
  await writeFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, "agent-control.json"), JSON.stringify({ mode: "success" }));
  const project = await getWorkspace(request);
  const catalog = await getWorkflowCatalog(request, project.id);
  const type = catalog.issue_types.nodes.find(row => row.name === "Module")!;
  const folder = await mkdtemp(join(tmpdir(), "ticketry-conversations-"));
  const module = await createModule(request, project.id, { name: `Conversations ${Date.now()}`, issue_type_id: type.id });
  await selectModuleForProfile(request, project.id, module.id, folder);
  await configureCodexDefault(request);
  return { project, module, folder };
}

export async function conversationRows(request: APIRequestContext, projectId: string, moduleId: string) {
  return (await graphql(request, InstantRunTicketsDocument, { projectId, moduleId })).tickets;
}

export async function observeConversationLaunch(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse(response => response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === "CreateTerminalSession");
  await action();
  const completed = await response;
  const envelope = await completed.json();
  expect(envelope.errors, JSON.stringify(envelope)).toBeUndefined();
  expect(envelope.data.terminal_session.agent_run_id).toBeTruthy();
  return { runId: envelope.data.terminal_session.agent_run_id as string, variables: completed.request().postDataJSON().variables as Record<string, unknown> };
}

export async function releaseConversation(runId: string) {
  await writeFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, `${runId}.release`), "release");
}

export async function fixtureConversation(runId: string) {
  try {
    return JSON.parse(await readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, `${runId}.interactive.json`), "utf8")) as { runId: string; sessionId: string; pid: number };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeConversationModule(folder: string) {
  await rm(folder, { recursive: true, force: true });
}

export async function completedConversations(request: APIRequestContext, projectId: string, moduleId: string) {
  return (await graphql(request, ScratchResumableTerminalSessionsDocument, { projectId, moduleId })).resumable_sessions;
}
