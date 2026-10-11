import { createApolloStore } from "../../../shared/apollo/localState";
import { publicWorktrackerId } from "../../../shared/api/generatedWorktracker";

export type StorySprintIntent =
  | { mode: "active" }
  | { mode: "all" }
  | { mode: "none" }
  | { mode: "id"; sprintId: string };

const ACTIVE: StorySprintIntent = { mode: "active" };

interface StorySprintFilterState {
  intentsByProject: Record<string, StorySprintIntent>;
  generationsByProject: Record<string, number>;
  noticesByProject: Record<string, string | null>;
}

/** Session intent lives beside normalized records in Apollo; no disk persistence. */
const useStorySprintFilterStore = createApolloStore<StorySprintFilterState>(
  "story-sprint-filter",
  () => ({ intentsByProject: {}, generationsByProject: {}, noticesByProject: {} }),
);

export function getStorySprintFilterIntent(projectId: string | null): StorySprintIntent {
  return projectId
    ? useStorySprintFilterStore.getState().intentsByProject[publicWorktrackerId(projectId)] ?? ACTIVE
    : ACTIVE;
}

export function useStorySprintFilterIntent(projectId: string | null): StorySprintIntent {
  return useStorySprintFilterStore((state) => projectId
    ? state.intentsByProject[publicWorktrackerId(projectId)] ?? ACTIVE
    : ACTIVE);
}

export function setStorySprintFilterIntent(projectId: string, intent: StorySprintIntent): void {
  useStorySprintFilterStore.setState((state) => ({
    generationsByProject: { ...state.generationsByProject, [publicWorktrackerId(projectId)]:
      (state.generationsByProject[publicWorktrackerId(projectId)] ?? 0) + 1 },
    intentsByProject: { ...state.intentsByProject, [publicWorktrackerId(projectId)]: intent.mode === "id"
      ? { ...intent, sprintId: publicWorktrackerId(intent.sprintId) } : intent },
  }));
}

export function useStorySprintFilterNotice(projectId: string | null): string | null {
  return useStorySprintFilterStore((state) => projectId
    ? state.noticesByProject[publicWorktrackerId(projectId)] ?? null
    : null);
}

export function setStorySprintFilterNotice(projectId: string, notice: string | null): void {
  useStorySprintFilterStore.setState((state) => ({
    noticesByProject: { ...state.noticesByProject, [publicWorktrackerId(projectId)]: notice },
  }));
}

export function clearStorySprintFilter(projectId: string): void {
  setStorySprintFilterIntent(projectId, { mode: "all" });
}

export function getStorySprintFilterGeneration(projectId: string | null): number {
  return projectId ? useStorySprintFilterStore.getState().generationsByProject[publicWorktrackerId(projectId)] ?? 0 : 0;
}
export function useStorySprintFilterGeneration(projectId: string | null): number {
  return useStorySprintFilterStore((state) => projectId ? state.generationsByProject[publicWorktrackerId(projectId)] ?? 0 : 0);
}

/** Invalidate navigation when semantic Active resolves to a different identity. */
export function advanceStorySprintFilterGeneration(projectId: string): void {
  useStorySprintFilterStore.setState((state) => ({ generationsByProject: {
    ...state.generationsByProject,
    [publicWorktrackerId(projectId)]: (state.generationsByProject[publicWorktrackerId(projectId)] ?? 0) + 1,
  } }));
}
