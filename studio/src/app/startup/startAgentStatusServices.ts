import {
  startStallDeadlines,
  stopStallDeadlines,
} from "../../features/agents/status";
import { statusStreamFeed } from "../../features/agents/status/stream/statusStreamFeed";
import { launchkeyStartup } from "../../features/launchkey";
import { editionHas } from "../../shared/config/edition";
import { studioRuntime, type StudioRuntime } from "../../runtime";
import type { CreateGraphQlTransportProxy } from "../../runtime/graphQlTransport";

export function startAgentStatusServices(
  projectId: string,
  createProxy: CreateGraphQlTransportProxy,
  runtime: StudioRuntime = studioRuntime(),
): () => void {
  statusStreamFeed.start(projectId, { createProxy });
  startStallDeadlines();
  // Pocock hosts never initialize the LaunchKey plugin, so nothing may invoke it.
  if (editionHas("launchkeyMidi")) launchkeyStartup.start(runtime);

  return () => {
    statusStreamFeed.stop();
    stopStallDeadlines();
  };
}
