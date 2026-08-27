import { invoke, isTauri } from "@tauri-apps/api/core";

import { createDefaultInteractiveTaskLaunch } from "./mutationTransport";

/** The project/module context a browser launch needs to bind its identities. */
export interface DefaultAgentLaunchContext {
  readonly projectId: string;
  readonly moduleId: string;
}

/**
 * Desktop launches keep Rust launch-policy resolution behind the Tauri command;
 * browser launches use the model-shaped GraphQL terminal_session_create seam.
 * Either way no caller-supplied provider, model, reasoning, or prompt reaches
 * the run: a default interactive launch belongs to launch authority.
 */
export async function launchDefaultAgent(
  issueId: string,
  context?: DefaultAgentLaunchContext,
): Promise<void> {
  if (isTauri()) {
    await invoke("desktop_launch_default_coding_agent", { issueId });
    return;
  }
  if (!context) {
    throw new Error(
      "The browser agent launch requires its work item's project and module.",
    );
  }
  await createDefaultInteractiveTaskLaunch({
    projectId: context.projectId,
    issueId,
    moduleId: context.moduleId,
  });
}
