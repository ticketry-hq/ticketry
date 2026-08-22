import { invoke, isTauri } from "@tauri-apps/api/core";

/** Task launch exists only on the Rust desktop runtime. */
export async function launchDefaultAgent(issueId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Task launch requires the Ticketry desktop runtime.");
  }
  await invoke("desktop_launch_default_coding_agent", { issueId });
}
