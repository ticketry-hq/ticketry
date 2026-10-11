import { useEffect, useReducer, useRef } from "react";
import { useClientStore } from "../../state/clientStore";
import { useStudioStore } from "../projects";
import { getModuleFolder } from "../module-links";
import { getEffectiveModuleTabsSnapshot, type EffectiveModuleTabs } from "./effectiveModuleTabs";
import { ROADMAP_ENABLED } from "../../shared/config/roadmapAvailability";

type SelectionAttempt = { intent: string; target: string; generation: string; pending: boolean; interrupted: boolean };

/** Project-lifetime request control only; module/Story records remain in Apollo. */
export function useSprintModuleSelection(projectId: string | null, projection: EffectiveModuleTabs, deferred: boolean) {
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const attempt = useRef<SelectionAttempt | null>(null);
  const deferredRef = useRef(deferred);
  const restriction = useRef({ projectId, applied: false });
  const [completion, wake] = useReducer((value: number) => value + 1, 0);
  deferredRef.current = deferred;
  useEffect(() => {
    if (!ROADMAP_ENABLED) return;
    if (deferred) {
      if (attempt.current?.pending) attempt.current.interrupted = true;
      return;
    }
    if (restriction.current.projectId !== projectId) restriction.current = { projectId, applied: false };
    if (!projectId || !projection.complete) return;
    if (projection.restricted) restriction.current.applied = true;
    // Normal startup/creation navigation remains owned by its existing flow.
    // All only recovers a cleared sprint restriction or an excluded selection.
    if (!projection.restricted && !selectedModuleId && !restriction.current.applied) return;
    const state = useClientStore.getState();
    const eligible = projection.modules.some(({ id }) => id === selectedModuleId);
    const previous = attempt.current;
    if (previous?.pending && previous.generation !== projection.generation) previous.interrupted = true;
    const resume = eligible && !selectedTaskId && previous?.target === selectedModuleId
      && !previous.pending && previous.interrupted;
    if (eligible && !resume) return;
    const target = resume ? selectedModuleId : projection.modules[0]?.id;
    if (!target) {
      if (projection.noMatches && selectedModuleId) state.deselectModule();
      return;
    }
    const intent = JSON.stringify([projection.generation, target]);
    if (!resume && previous?.intent === intent) return;
    const current: SelectionAttempt = { intent, target, generation: projection.generation, pending: true, interrupted: false };
    attempt.current = current;
    const isCurrent = () => !deferredRef.current
      && useStudioStore.getState().selectedProjectId === projectId
      && getEffectiveModuleTabsSnapshot(projectId).generation === projection.generation
      && getEffectiveModuleTabsSnapshot(projectId).modules.some(({ id }) => id === target);
    // The workspace action owns the existing folder/trust UI and guarded save.
    // Clearing only selection preserves dormant workspaces, documents and runs.
    if (!getModuleFolder(target) && selectedModuleId) state.deselectModule();
    const completed = () => {
      if (attempt.current !== current) return;
      if (!isCurrent()) current.interrupted = true;
      current.pending = false;
      wake();
    };
    void state.selectModule(target, { isCurrent }).then(completed, completed);
  }, [projectId, projection.generation, projection.complete, projection.restricted,
    projection.noMatches, selectedModuleId, selectedTaskId, deferred, completion]);
}
