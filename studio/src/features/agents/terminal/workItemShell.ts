/**
 * Launching a Work Item's durable login shell (`task_shell`).
 *
 * A plain login shell opened in the Work Item's worktree and recorded as an
 * Agent Run. It is the module shell's task-scoped sibling: same `"shell"`
 * durable scope, but bound to the work item rather than the module scratch id.
 * The mutation carries identities only — project ancestry and the workspace
 * identity are derived from the Work Item row server-side.
 */

import { studioRuntime } from "../../../runtime";
import { FoundationGraphQlError } from "../../../shared/apollo/errorLink";
import { graphQlMutationError } from "../../../shared/api/graphqlError";
import { CreateWorkItemShellDocument } from "./generated/terminalSessions.documents";
import { refreshTerminalHoldings } from "./refresh";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/** Launches one durable login shell in a Work Item's worktree. */
export async function createWorkItemShell(
  issueId: string,
  moduleId: string,
): Promise<string> {
  const variables = {
    clientRequestId: crypto.randomUUID(),
    issueId,
    moduleId,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
  };
  const result = await studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      try {
        let response;
        try {
          response = await execute(CreateWorkItemShellDocument, variables);
        } catch (error) {
          if (error instanceof FoundationGraphQlError) throw error;
          response = await execute(CreateWorkItemShellDocument, variables);
        }
        return { agent_run_id: response.terminal_session.agent_run_id };
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
  await refreshTerminalHoldings();
  return result.agent_run_id;
}
