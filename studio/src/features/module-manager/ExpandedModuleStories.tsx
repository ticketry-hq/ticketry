import { PlanningRowView, formatWorkItemDisplayIdentifier } from "../work-items";
import { stateById, useCachedStates } from "../projects";
import { useExpandedModuleStories } from "./useExpandedModuleStories";
import { useLayoutEffect, useRef } from "react";
import { useModuleManagerStore } from "./state";
import { restoreInspectionCursor } from "./restoreInspectionCursor";

/** Inspection preserves workspace selection and sprint intent, including for hidden/archived modules. */
export function ExpandedModuleStories({ projectId, moduleId, moduleName }: { projectId: string; moduleId: string; moduleName: string }) {
  const { stories, complete, loading, error, retry } = useExpandedModuleStories(projectId, moduleId);
  const states = useCachedStates(projectId);
  const root = useRef<HTMLDivElement>(null);
  const focusedStory = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const manager = root.current?.closest("[data-module-manager]");
    const generation = useModuleManagerStore.getState().generation;
    return () => {
      const id = focusedStory.current?.dataset.moduleManagerStory;
      if (id && manager) restoreInspectionCursor(manager, projectId, moduleId, id, generation);
    };
  }, [moduleId, projectId]);
  useLayoutEffect(() => {
    if (!focusedStory.current || focusedStory.current.isConnected) return;
    // A surviving keyed row keeps its native focus. If membership removed that
    // row, keep the user on its module instead of leaving the cursor on body.
    if (document.activeElement === document.body) {
      const manager = root.current?.closest("[data-module-manager]");
      const survivor = Array.from(manager?.querySelectorAll<HTMLElement>("[data-module-manager-story]") ?? [])
        .find((element) => element.dataset.moduleManagerStory === focusedStory.current?.dataset.moduleManagerStory
          && element.dataset.moduleManagerStoryModule === moduleId);
      if (survivor) { survivor.focus(); focusedStory.current = survivor; return; }
      if (loading) return;
      Array.from(manager?.querySelectorAll<HTMLElement>("[data-module-manager-inspect]") ?? [])
        .find((element) => element.dataset.moduleManagerInspect === moduleId)?.focus();
    }
    focusedStory.current = null;
  }, [stories, moduleId, loading]);
  return <div ref={root} data-module-manager-stories={moduleId} data-module-manager-stories-pending={loading ? "true" : "false"}
    className="min-w-0 border-t border-pane-border/50 px-4 py-2" onFocusCapture={(event) => {
    focusedStory.current = (event.target as HTMLElement).closest<HTMLElement>("[data-module-manager-story]");
  }} onBlurCapture={(event) => {
    if (event.relatedTarget instanceof HTMLElement) focusedStory.current = null;
  }}>
    {loading ? <p role="status" className="text-xs text-text-muted">Loading stories in {moduleName}…</p> : null}
    {error ? <div role="alert" className="text-xs text-lifecycle-danger">{error}
      <button type="button" aria-label={"Retry stories in " + moduleName} onClick={() => { void retry(); }}
        className="ml-2 underline focus-visible:outline focus-visible:outline-focus-accent">Retry</button></div> : null}
    {complete ? <ul role="tree" aria-label={"Stories in " + moduleName} aria-busy={loading} onClick={(event) => {
      (event.target as Element).closest<HTMLElement>("[data-module-manager-story]")?.focus();
    }}>
      {stories.map((story) => <PlanningRowView key={story.id} id={story.id} depth={1} expandable={false} expanded={false}
        inspectionModuleId={moduleId} identifier={formatWorkItemDisplayIdentifier(story.sequence_id)}
        stateColor={stateById(states, story.state)?.color ?? null} name={story.name} isSelected={false}
        descendantIds={[]} onClick={() => {}} onToggleExpand={() => {}} />)}
      {!stories.length && !loading && !error ? <li className="text-xs text-text-muted">No top-level stories</li> : null}
    </ul> : null}
  </div>;
}
