import { FoundationGraphQlError } from "../../../../shared/apollo/errorLink";
import { studioRuntime } from "../../../../runtime";
import { graphQlMutationError } from "../../../../shared/api/graphqlError";
import type { ResumableTerminalSession } from "../../types";
import { refreshTerminalHoldings } from "../refresh";
import {
  CreateTerminalSessionDocument,
  ResumeTerminalSessionDocument,
  UpdateTerminalSessionDocument,
} from "../generated/terminalSessions.documents";
import type {
  CreateTerminalSessionMutationVariables as CreateTerminalSessionVariables,
} from "../generated/terminalSessions.documents";
import {
  isTerminalProvider,
  type TerminalProvider,
} from "../presentation/providerPresentation";

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

/**
 * Terminal runs are created, resumed, and terminated by the Rust terminal
 * lifecycle over the in-process GraphQL transport. The Python `/api/terminals`
 * routes that browser development used to post to were retired with the rest
 * of the Python terminal authority, so a platform without that transport has
 * no terminal writer at all rather than a dead one.
 */
async function retryTransport<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FoundationGraphQlError) throw error;
    return operation();
  }
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

export interface DefaultInteractiveTaskLaunchInput {
  readonly projectId: string;
  readonly issueId: string;
  readonly moduleId: string;
}

export interface DefaultInstantConversationLaunchInput {
  readonly projectId: string;
  readonly moduleId: string;
}

export interface CreatedInstantConversation {
  readonly agent_run_id: string;
  readonly agent: TerminalProvider;
}

/**
 * Create one Instant conversation ready for terminal input. Provider, model,
 * standing instructions, and auto-close policy come from Rust launch authority.
 */
export async function createDefaultInstantConversation(
  input: DefaultInstantConversationLaunchInput,
): Promise<CreatedInstantConversation> {
  const variables = {
    clientRequestId: crypto.randomUUID(),
    projectId: input.projectId,
    issueId: input.moduleId,
    moduleId: input.moduleId,
    targetId: input.moduleId,
    kind: "instant",
    workingDirectoryIdentity: `module:${compactIdentity(input.moduleId)}`,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
  } as const;
  const result = await studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      try {
        const response = await retryTransport(() =>
          execute(CreateTerminalSessionDocument, variables)
        );
        const agent = response.terminal_session.agent_run?.agent ?? null;
        if (!isTerminalProvider(agent)) {
          throw new Error("The launched conversation has no terminal provider.");
        }
        return {
          agent_run_id: response.terminal_session.agent_run_id,
          agent,
        };
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
  await refreshTerminalHoldings();
  return result;
}

/**
 * The browser's task-launch path over the one model-shaped
 * `terminal_session_create` seam. It carries identities only: provider, model,
 * reasoning, and prompt are deliberately absent so the backend's interactive
 * launch authority resolves the run's material exactly as the desktop command
 * does.
 */
export async function createDefaultInteractiveTaskLaunch(
  input: DefaultInteractiveTaskLaunchInput,
): Promise<{ agent_run_id: string }> {
  const variables = {
    clientRequestId: crypto.randomUUID(),
    projectId: input.projectId,
    issueId: input.issueId,
    moduleId: input.moduleId,
    targetId: input.issueId,
    kind: "task",
    workingDirectoryIdentity: `task:${compactIdentity(input.issueId)}`,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
  } as const;
  const result = await studioRuntime().writeWorkTracker({
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
  return result;
}
