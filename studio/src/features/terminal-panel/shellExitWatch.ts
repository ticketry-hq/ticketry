/**
 * Turns a shell run's ending into what the panel does about it (#670).
 *
 * The panel never decides for itself that a shell has ended. It reads the run
 * projection — the same one every other Studio surface reads — which is fed by
 * the pushed completion frame and repaired by backend reconciliation. That is
 * what makes the panel behave identically under the native renderer and the
 * browser fallback: neither transport is consulted, because a viewer closing is
 * a fact about a viewer and never about the durable session behind it.
 */

import { useEffect } from "react";

import {
  isLiveAgentRunState,
  projectRunPresentation,
  useAgentStatusStore,
  type AgentStatusData,
  type RunRecord,
} from "../agents/status";
import { useModuleShellStore } from "./moduleShellStore";

/** Whether the run projection says this run has reached its end. */
function hasEnded(run: RunRecord): boolean {
  return !isLiveAgentRunState(projectRunPresentation(run));
}

/** Applies every ending the run projection currently holds for this module. */
function applyEndings(moduleId: string, runs: AgentStatusData["runs"]): void {
  const shells = useModuleShellStore.getState();
  const set = shells.byModule[moduleId];
  if (!set) return;
  for (const runId of set.runIds) {
    const run = runs[runId];
    if (!run || !hasEnded(run)) continue;
    shells.noteShellExit(moduleId, runId, run.exit_code ?? null);
  }
}

/**
 * Keeps the showing module's shell strip in step with its runs' endings.
 *
 * Both a first pass and a subscription are needed: an ending can arrive while
 * the panel is closed and the strip must catch up the moment it opens, and one
 * that arrives while it is open must land without waiting for anything else to
 * re-render.
 */
export function useShellExitWatch(moduleId: string | null): void {
  useEffect(() => {
    if (!moduleId) return;
    applyEndings(moduleId, useAgentStatusStore.getState().runs);
    return useAgentStatusStore.subscribe((state) => {
      applyEndings(moduleId, state.runs);
    });
  }, [moduleId]);
}
