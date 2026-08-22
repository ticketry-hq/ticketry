import { FoundationGraphQlError } from "../../../../graphql-foundation/foundationClient";
import { studioRuntime } from "../../../../runtime";
import { graphQlMutationError } from "../../../../shared/api/graphqlError";
import { authenticatedHostFetch } from "../../../../shared/api/authenticatedHostFetch";
import { queryClient } from "../../../../shared/query/queryClient";
import type { ResumableTerminalSession } from "../../types";
import {
  CreateTerminalSessionDocument,
  ResumeTerminalSessionDocument,
  UpdateTerminalSessionDocument,
  type CreateTerminalSessionVariables,
} from "../generated/terminalSessions";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

export interface CreateTerminalRunInput {
  readonly agent: "claude" | "agy" | "codex" | "gemini";
  readonly projectId: string;
  readonly moduleId: string;
  readonly taskId: string | null;
  readonly initialPrompt: string | null;
  readonly isPlanning: boolean;
  readonly isInstant: boolean;
}

export interface ResumeTerminalRunInput {
  readonly source: ResumableTerminalSession;
  readonly projectId: string;
  readonly moduleId: string;
  readonly taskId: string | null;
}

function compactIdentity(value: string): string {
  return value.replace(/-/g, "");
}

async function browserRequest<TResult>(
  path: string,
  init: RequestInit,
): Promise<TResult> {
  const response = await authenticatedHostFetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Terminal request failed with HTTP ${response.status}.`);
  return body as TResult;
}

async function retryTransport<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FoundationGraphQlError) throw error;
    return operation();
  }
}

async function refreshTerminalHoldings(): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: ["terminal-sessions"],
    refetchType: "active",
  });
}

function launchVariables(
  input: CreateTerminalRunInput,
  clientRequestId: string,
): CreateTerminalSessionVariables {
  const kind = input.isPlanning
    ? "planning"
    : input.isInstant
      ? "instant"
      : "task";
  const issueId = input.taskId ?? input.moduleId;
  const targetId = input.taskId ?? input.moduleId;
  const workingDirectoryIdentity = input.taskId
    ? `task:${compactIdentity(input.taskId)}`
    : `module:${compactIdentity(input.moduleId)}`;
  return {
    clientRequestId,
    projectId: input.projectId,
    issueId,
    moduleId: input.moduleId,
    targetId,
    kind,
    provider: input.agent,
    workingDirectoryIdentity,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    prompt: input.initialPrompt,
  };
}

export async function createTerminalSession(
  input: CreateTerminalRunInput,
): Promise<{ agent_run_id: string }> {
  const variables = launchVariables(input, crypto.randomUUID());
  const result = await studioRuntime().writeWorkTracker({
    rest: () => browserRequest<{ agent_run_id: string }>("/api/terminals", {
      method: "POST",
      body: JSON.stringify({
        agent: input.agent,
        project_id: input.projectId,
        module_id: input.moduleId,
        task_id: input.taskId,
        initial_prompt: input.isInstant ? null : input.initialPrompt,
        is_planning: input.isPlanning,
        is_instant: input.isInstant,
        instant_prompt: input.isInstant ? input.initialPrompt : null,
      }),
    }),
    graphQl: async (execute) => {
      try {
        const response = await retryTransport(() =>
          execute(CreateTerminalSessionDocument, variables)
        );
        return { agent_run_id: response.terminal_session.agent_run_id };
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
  await refreshTerminalHoldings();
  return result;
}

export async function resumeTerminalSession(
  input: ResumeTerminalRunInput,
): Promise<{ agent_run_id: string; resumed_from: string }> {
  const source = input.source;
  const kind = source.scope === "plan" ? "planning" : source.scope === "instant" ? "instant" : "task";
  const issueId = input.taskId ?? input.moduleId;
  const targetId = input.taskId ?? input.moduleId;
  const variables = {
    clientRequestId: crypto.randomUUID(),
    projectId: input.projectId,
    issueId,
    moduleId: input.moduleId,
    targetId,
    kind,
    provider: source.agent,
    workingDirectoryIdentity: input.taskId
      ? `task:${compactIdentity(input.taskId)}`
      : `module:${compactIdentity(input.moduleId)}`,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    resumeFromAgentRunId: source.agent_run_id,
    model: source.launch_model ?? null,
  } as const;
  const result = await studioRuntime().writeWorkTracker({
    rest: () => browserRequest<{ agent_run_id: string; resumed_from: string }>(
      `/api/terminals/resume?agent_run_id=${encodeURIComponent(source.agent_run_id)}`,
      { method: "POST" },
    ),
    graphQl: async (execute) => {
      try {
        const response = await retryTransport(() =>
          execute(ResumeTerminalSessionDocument, variables)
        );
        return {
          agent_run_id: response.terminal_session.agent_run_id,
          resumed_from: source.agent_run_id,
        };
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
  await refreshTerminalHoldings();
  return result;
}

export async function terminateTerminalSession(
  agentRunId: string,
): Promise<{ agent_run_id: string; terminated: boolean }> {
  const variables = {
    agentRunId,
    terminationRequestId: crypto.randomUUID(),
  };
  const result = await studioRuntime().writeWorkTracker({
    rest: () => browserRequest<{ agent_run_id: string; terminated: boolean }>(
      `/api/terminals?agent_run_id=${encodeURIComponent(agentRunId)}`,
      { method: "DELETE" },
    ),
    graphQl: async (execute) => {
      try {
        const response = await retryTransport(() =>
          execute(UpdateTerminalSessionDocument, variables)
        );
        return {
          agent_run_id: response.terminal_session.agent_run_id,
          terminated: true,
        };
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
  await refreshTerminalHoldings();
  return result;
}
