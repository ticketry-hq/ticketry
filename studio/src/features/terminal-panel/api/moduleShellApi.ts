/**
 * The wire calls for a module's durable login shells (#667).
 *
 * A shell run is created and listed through `/api/terminals/shells`, which is
 * deliberately separate from the agent-run terminal routes: it resolves no
 * provider and carries no prompt. Ending one is *not* here — a shell run
 * terminates through the same terminal deletion as any other durable run.
 */

import { authenticatedHostFetch } from "../../../shared/api/authenticatedHostFetch";

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

async function readEnvelope(response: Response): Promise<{ code?: string }> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as { code?: string }) : {};
  } catch {
    return {};
  }
}

/** Launches one durable login shell and returns the run that hosts it. */
export async function createModuleShell(moduleId: string): Promise<string> {
  const response = await authenticatedHostFetch("/api/terminals/shells", {
    method: "POST",
    body: JSON.stringify({ module_id: moduleId }),
  });
  if (response.status === 409) {
    const { code } = await readEnvelope(response);
    throw new ModuleShellRefused(code ?? "module_folder_unset");
  }
  if (!response.ok) {
    throw new Error(`shell launch failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { agent_run_id: string };
  return body.agent_run_id;
}

export async function listModuleShells(
  moduleId: string,
  signal?: AbortSignal,
): Promise<ModuleShell[]> {
  const response = await authenticatedHostFetch(
    `/api/terminals/shells?module_id=${encodeURIComponent(moduleId)}`,
    { signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as ModuleShell[];
}
