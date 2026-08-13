import { invoke, isTauri } from "@tauri-apps/api/core";
import { createAgentStatusClient } from "@worktracker/typescript-sdk/agent-status";
import { agentApiBase, apiKey } from "../../../../shared/api/client";

/** Desktop launches cross the Rust policy authority before Django effects. */
export async function launchDefaultAgent(issueId: string): Promise<void> {
  if (isTauri()) {
    await invoke("desktop_launch_default_coding_agent", { issueId });
    return;
  }
  const client = createAgentStatusClient({
    baseUrl: agentApiBase(),
    apiKey: apiKey(),
  });
  await client.launchAgent({ issueId });
}
