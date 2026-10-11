import { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useActiveStorySprint, useSelectedStorySprint, subscribeSprintChoicesRefresh } from "../../sprints";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { useProjectStorySprintIndex } from "../queries/useProjectStorySprintIndex";
import { useStorySprintFilterIntent, setStorySprintFilterIntent, advanceStorySprintFilterGeneration, useStorySprintFilterNotice, setStorySprintFilterNotice, type StorySprintIntent } from "../internal/storySprintFilterStore";
import { resolveStorySprintFilter } from "../selectors/storySprintFilter";
import { ROADMAP_ENABLED } from "../../../shared/config/roadmapAvailability";

function useController(projectId: string | null) {
  const intent = useStorySprintFilterIntent(projectId);
  const notice = useStorySprintFilterNotice(projectId);
  const active = useActiveStorySprint(projectId);
  const selected = useSelectedStorySprint(projectId, intent.mode === "id" ? intent.sprintId : null);
  const index = useProjectStorySprintIndex(projectId);
  const resolution = resolveStorySprintFilter(intent, active, selected);
  const activeScope = intent.mode === "active" ? JSON.stringify([projectId, resolution.selection]) : null;
  const previousActiveScope = useRef(activeScope);
  useEffect(() => {
    if (projectId && activeScope !== null && previousActiveScope.current !== null
      && previousActiveScope.current !== activeScope) advanceStorySprintFilterGeneration(projectId);
    previousActiveScope.current = activeScope;
  }, [projectId, activeScope]);
  useEffect(() => {
    if (projectId && resolution.requiresAllFallback) {
      setStorySprintFilterNotice(projectId, resolution.notice ?? null);
      setStorySprintFilterIntent(projectId, { mode: "all" });
    }
  }, [projectId, resolution.requiresAllFallback, resolution.notice]);
  const setIntent = useCallback((next: StorySprintIntent) => {
    if (projectId) { setStorySprintFilterNotice(projectId, null); setStorySprintFilterIntent(projectId, next); }
  }, [projectId]);
  const retry = useCallback(() => {
    void Promise.allSettled([active.retry(), index.retry(), ...(intent.mode === "id" ? [selected.retry()] : [])]);
  }, [active.retry, selected.retry, index.retry, intent.mode]);
  useEffect(() => {
    if (!projectId) return;
    const refresh = () => retry();
    window.addEventListener("focus", refresh);
    const unsubscribe = subscribeSprintChoicesRefresh((changedProjectId) => {
      if (compactWorktrackerId(changedProjectId) === compactWorktrackerId(projectId)) retry();
    });
    return () => { window.removeEventListener("focus", refresh); unsubscribe(); };
  }, [projectId, retry]);
  return { ...resolution, projectId, notice: notice ?? resolution.notice, intent, setIntent, activeSprint: active.sprint,
    selectedSprint: selected.sprint, roots: index.roots, complete: index.complete,
    status: resolution.status === "error" || index.error ? "error" as const
      : resolution.status === "loading" || !index.complete ? "loading" as const
      : "ready" as const,
    retry };
}

const Context = createContext<ReturnType<typeof useController> | null>(null);

/** One project lifetime network owner; React holds only the derived projection. */
export function StorySprintFilterController({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  const inherited = useContext(Context);
  return inherited ? children : <ControllerOwner projectId={projectId}>{children}</ControllerOwner>;
}
function ControllerOwner({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  return ROADMAP_ENABLED
    ? <RoadmapControllerOwner projectId={projectId}>{children}</RoadmapControllerOwner>
    : <OrdinaryStoriesOwner projectId={projectId}>{children}</OrdinaryStoriesOwner>;
}
function RoadmapControllerOwner({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  const controller = useController(projectId);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
function OrdinaryStoriesOwner({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  // Availability is compiled. OFF never reads or rewrites remembered planning
  // intent; ordinary Story readiness depends only on its module records.
  const controller: ReturnType<typeof useController> = {
    projectId, selection: { mode: "all" }, restricted: false, status: "ready",
    requiresAllFallback: false, notice: undefined, intent: { mode: "all" },
    setIntent: () => {}, retry: () => {}, activeSprint: null, selectedSprint: null,
    roots: [], complete: true,
  };
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useStorySprintFilter(_projectId?: string | null) {
  const controller = useContext(Context);
  if (!controller) throw new Error("Stories require StorySprintFilterController");
  return controller;
}
