/**
 * Seeding the live-run holding during bootstrap, ahead of the subscription.
 *
 * The durable stream is authoritative, but its snapshot arrives after the shell
 * has already started rendering, so it lands behind the first render's work and
 * the badges appear a beat after the issues. This reads the same projections as
 * a plain query while bootstrap is still running, so the holding is populated
 * before that render begins.
 *
 * It is a seed, never a second owner: the rows go through the same adapters
 * into the same holding writer the snapshot uses, and the stream's own snapshot
 * replaces them a moment later. Failure is swallowed — a preload that cannot
 * read leaves the badges to the subscription, which is where they came from
 * before.
 */
import { studioApolloClient } from "../../../../shared/apollo/client";
import {
  replaceAgentStatusSnapshot,
  switchAgentStatusProject,
} from "../apolloHolding";
import { LiveRunStatusPreloadDocument } from "../generated/statusStream.documents";
import { recordLaunchDiscovery } from "../launchDiscoveryTrace";
import { toAutomationAttemptRecord, toRunRecord } from "./statusHoldingAdapters";

export async function preloadLiveRunStatus(projectId: string): Promise<void> {
  try {
    const { data } = await studioApolloClient().query({
      query: LiveRunStatusPreloadDocument,
      variables: { projectId },
      // The holding is the owner of this data; a second copy under ROOT_QUERY
      // would only be a stale twin nothing reads.
      fetchPolicy: "no-cache",
    });
    if (!data) return;
    switchAgentStatusProject(projectId);
    recordLaunchDiscovery(
      "apollo-run-applied",
      { projectId, agentRunId: null, cursor: null, connectionGeneration: null },
      { source: "preload", runCount: data.agent_run_holdings.length },
    );
    replaceAgentStatusSnapshot(
      projectId,
      data.agent_run_holdings.map(toRunRecord),
      data.automation_attempts.map(toAutomationAttemptRecord),
    );
  } catch (error) {
    console.warn("[statusPreload] live run preload failed", error);
  }
}
