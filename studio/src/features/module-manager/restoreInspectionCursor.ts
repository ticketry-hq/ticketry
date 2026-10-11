import { useModuleManagerStore } from "./state";

/** Transient DOM cursor recovery when a complete eligibility read remounts a module group. */
export function restoreInspectionCursor(manager: Element, projectId: string, moduleId: string, storyId: string, generation: number): void {
  let finished = false;
  const observer = new MutationObserver(attempt);
  const stop = () => {
    finished = true; observer.disconnect(); document.removeEventListener("focusin", attempt);
  };
  function attempt(): void {
    if (finished) return;
    const state = useModuleManagerStore.getState();
    if (!manager.isConnected || !state.active || state.projectId !== projectId || state.generation !== generation
      || document.activeElement !== document.body) { stop(); return; }
    const story = Array.from(manager.querySelectorAll<HTMLElement>("[data-module-manager-story]"))
      .find((element) => element.dataset.moduleManagerStory === storyId && element.dataset.moduleManagerStoryModule === moduleId);
    const parent = Array.from(manager.querySelectorAll<HTMLElement>("[data-module-manager-inspect]"))
      .find((element) => element.dataset.moduleManagerInspect === moduleId);
    const collection = Array.from(manager.querySelectorAll<HTMLElement>("[data-module-manager-stories]"))
      .find((element) => element.dataset.moduleManagerStories === moduleId);
    const target = story ?? (parent && (!state.expandedRows[moduleId] || collection?.dataset.moduleManagerStoriesPending === "false") ? parent : null);
    if (target) { stop(); target.focus(); }
  }
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-module-manager-stories-pending"] });
  document.addEventListener("focusin", attempt);
  requestAnimationFrame(attempt);
}
