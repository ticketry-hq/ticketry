import {
  createAgentStatusClient,
  type AutomationAttemptRecord,
} from "@worktracker/typescript-sdk/agent-status";
import { agentApiBase, apiKey } from "../../../shared/api/client";
import { useAgentStatusStore } from "./store";

export async function retryAutomationAttempt(
  attemptId: string,
): Promise<AutomationAttemptRecord> {
  const client = createAgentStatusClient({
    baseUrl: agentApiBase(),
    apiKey: apiKey(),
  });
  const attempt = await client.retryAutomationAttempt({ attemptId });
  useAgentStatusStore.getState().upsertAutomationAttempt(attempt);
  return attempt;
}
