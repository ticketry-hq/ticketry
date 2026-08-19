/**
 * Studio's only Automation Attempt retry writer.
 *
 * The Django endpoint this used to POST was retired at the Slice 3 handoff, so
 * the authored Rust command is the single retry authority. It reaches Rust over
 * the same in-process transport the status subscription runs on — attempts are
 * published by that stream and by nothing else, so a platform without it has no
 * attempt to retry rather than a second, weaker retry path.
 */
import { executeFoundationOperation } from "../../../graphql-foundation/foundationClient";
import { studioRuntime } from "../../../runtime";
import { graphQlMutationError } from "../../../shared/api/graphqlError";
import { RetryAutomationAttemptDocument } from "./generated/attempts";
import { useAgentStatusStore } from "./store";
import { toAutomationAttemptRecord } from "./stream/statusHoldingAdapters";
import type { AutomationAttemptRecord } from "./types";

export async function retryAutomationAttempt(
  attemptId: string,
): Promise<AutomationAttemptRecord> {
  const transport = studioRuntime().statusStream();
  if (transport === null) {
    throw new Error(
      "Automation Attempt retry requires the desktop status transport.",
    );
  }
  const attempt = await executeFoundationOperation(
    RetryAutomationAttemptDocument,
    { attemptId },
    transport,
  )
    .then((data) => toAutomationAttemptRecord(data.retry_automation_attempt))
    .catch((error: unknown) => graphQlMutationError(error));
  useAgentStatusStore.getState().upsertAutomationAttempt(attempt);
  return attempt;
}
