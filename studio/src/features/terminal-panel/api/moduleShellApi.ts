/**
 * The wire calls for a module's durable login shells (#667).
 *
 * Shells are created and listed through the Rust Terminal Session graph. The
 * `/api/terminals/shells` compatibility route browser development used went
 * away with the Python terminal authority, so a platform without the in-process
 * GraphQL transport has no shell surface. Neither create call accepts a
 * provider or prompt. Ending a shell still uses the common terminal update
 * contract.
 */

import { studioRuntime } from "../../../runtime";
import { FoundationGraphQlError } from "../../../graphql-foundation/foundationClient";
import { graphQlMutationError } from "../../../shared/api/graphqlError";
import {
  CreateModuleShellDocument,
  ModuleShellSessionsDocument,
} from "../../agents/terminal/generated/terminalSessions";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const SHELL_LIST_LIMIT = 100;

export interface ModuleShell {
  agent_run_id: string;
  module_id: string;
  created_at: string;
}

/**
 * The backend refused to launch a shell because the module has no usable
 * folder. `reason` is the backend's stable code, and every one of them means
 * the same remedy: point this module at a real directory first.
 */
export class ModuleShellRefused extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "ModuleShellRefused";
  }
}

/** Launches one durable login shell and returns the run that hosts it. */
export async function createModuleShell(moduleId: string): Promise<string> {
  const variables = {
    clientRequestId: crypto.randomUUID(),
    moduleId,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
  };
  const result = await studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      try {
        let response;
        try {
          response = await execute(CreateModuleShellDocument, variables);
        } catch (error) {
          if (error instanceof FoundationGraphQlError) throw error;
          response = await execute(CreateModuleShellDocument, variables);
        }
        return { agent_run_id: response.terminal_session.agent_run_id };
      } catch (error) {
        if (
          error instanceof FoundationGraphQlError &&
          error.code === "module_folder_unusable"
        ) {
          throw new ModuleShellRefused(error.code);
        }
        return graphQlMutationError(error);
      }
    },
  });
  return result.agent_run_id;
}

export async function listModuleShells(moduleId: string): Promise<ModuleShell[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => {
      const response = await execute(ModuleShellSessionsDocument, {
        moduleId,
        limit: SHELL_LIST_LIMIT,
      });
      return response.terminal_sessions.sessions.map((session) => ({
        agent_run_id: session.agent_run_id,
        module_id: session.module_id,
        created_at: session.created_at,
      }));
    },
  });
}
