/**
 * The wire calls for a module's durable login shells (#667).
 *
 * A shell run is created and listed through `/api/terminals/shells`, which is
 * deliberately separate from the agent-run terminal routes: it resolves no
 * provider and carries no prompt. Ending one is *not* here — a shell run
 * terminates through the same terminal deletion as any other durable run.
 */

import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { apiBase, apiKey } from "../../../shared/api/client";

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

const terminalsApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).terminals;

/** Launches one durable login shell and returns the run that hosts it. */
export async function createModuleShell(moduleId: string): Promise<string> {
  try {
    const result = await terminalsApi().terminalsShellsCreate({
      createModuleShell: { module_id: moduleId },
    });
    return result.agent_run_id;
  } catch (error) {
    if (!(error instanceof WorkTrackerApiError)) throw error;
    if (error.status === 409) {
      const body = error.body as { code?: string } | null;
      throw new ModuleShellRefused(body?.code ?? "module_folder_unset");
    }
    throw new Error(`shell launch failed (HTTP ${error.status})`);
  }
}

export async function listModuleShells(
  moduleId: string,
  signal?: AbortSignal,
): Promise<ModuleShell[]> {
  return terminalsApi().terminalsShellsList({ moduleId }, { signal });
}
