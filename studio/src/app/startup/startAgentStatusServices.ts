import {
  startStallDeadlines,
  stopStallDeadlines,
} from "../../features/agents/status";
import { statusStreamFeed } from "../../features/agents/status/stream/statusStreamFeed";
import { launchkeyStartup } from "../../features/launchkey";
import { studioRuntime, type StudioRuntime } from "../../runtime";
import type { CreateGraphQlTransportProxy } from "../../runtime/graphQlTransport";

export function startAgentStatusServices(
  projectId: string,
  createProxy: CreateGraphQlTransportProxy,
  runtime: StudioRuntime = studioRuntime(),
): () => void {
  statusStreamFeed.start(projectId, { createProxy });
  startStallDeadlines();
  launchkeyStartup.start(runtime);

  return () => {
    statusStreamFeed.stop();
    stopStallDeadlines();
  };
}
