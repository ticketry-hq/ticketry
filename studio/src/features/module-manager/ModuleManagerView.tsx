import { useEffect, useRef, type ReactNode } from "react";
import type { ModuleTabEntry } from "../module-tabs";
import { IconSearch, IconX } from "../../shared/ui/icons";
import { ModuleManagerRow } from "./ModuleManagerRow";
import { InlineModuleCreation } from "./InlineModuleCreation";
import { projectModuleManagerGroups } from "./projection";
import { registerModuleManagerKeyboardHandler } from "./keyboardNavigation";
import { beginModuleManagerCreation, closeModuleManager, inspectModuleManagerModule, leaveModuleManagerDetail, selectModuleManagerModule, setModuleManagerExpanded, setModuleManagerSearch, toggleModuleManagerGroup, useModuleManagerStore } from "./state";
import { useManagerActions } from "./useManagerActions";
import { ModuleManagerDetail } from "./ModuleManagerDetail";
import { useNarrowModuleManager } from "./useNarrowModuleManager";
import { ExpandedModuleStories } from "./ExpandedModuleStories";
import { useModuleReorderDrag } from "../projects";

export interface ModuleManagerViewProps {
  projectId: string | null; projectName: string;
  entries: readonly ModuleTabEntry[]; folders: Readonly<Record<string, string>>;
  accents?: Readonly<Record<string, string | null>>; loading: boolean;
  reorderEnabled?: boolean;
  eligibilityError?: Error; onRetryEligibility?: () => void;
  archivedLoading: boolean; archivedError?: Error; onRetryArchived: () => void;
  renderInspection?: (entry: ModuleTabEntry) => ReactNode;
}

export function ModuleManagerView({ projectId, projectName, entries, folders, accents = {}, loading, reorderEnabled = false,
  eligibilityError, onRetryEligibility, archivedLoading, archivedError, onRetryArchived, renderInspection }: ModuleManagerViewProps) {
  const state = useModuleManagerStore((value) => value);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const act = useManagerActions();
  const canReorder = reorderEnabled && !state.search.trim() && !state.renameEdit
    && !Object.values(state.pendingActions).some(Boolean);
  const drag = useModuleReorderDrag(canReorder ? projectId : null, "vertical");
  const groups = projectModuleManagerGroups(entries, state.search, folders, state.collapsedGroups);
  const visibleIds = groups.flatMap((group) => group.expanded ? group.entries.map(({ module }) => module.id) : []);
  const selectedVisible = state.selectedModuleId !== null && visibleIds.includes(state.selectedModuleId);
  const selectedEntry = entries.find(({ module }) => module.id === state.selectedModuleId);
  const narrow = useNarrowModuleManager();
  const drillIn = narrow && state.detailOpen && !!selectedEntry;
  const goBack = () => {
    leaveModuleManagerDetail();
    requestAnimationFrame(() => {
      const current = useModuleManagerStore.getState();
      if (!current.active || current.detailOpen) return;
      Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-module-manager-inspect]") ?? [])
        .find((element) => element.dataset.moduleManagerInspect === current.selectedModuleId)?.focus();
    });
  };

  useEffect(() => { searchRef.current?.focus(); }, [projectId]);
  useEffect(() => {
    if (!state.selectedModuleId || selectedVisible) return;
    const previousIndex = entries.findIndex(({ module }) => module.id === state.selectedModuleId);
    const nearest = visibleIds.reduce<string | null>((best, id) => {
      if (!best) return id;
      const distance = (candidate: string) => Math.abs(entries.findIndex(({ module }) => module.id === candidate) - previousIndex);
      return distance(id) < distance(best) ? id : best;
    }, null);
    selectModuleManagerModule(nearest);
  }, [state.selectedModuleId, selectedVisible, visibleIds.join("|")]);
  useEffect(() => registerModuleManagerKeyboardHandler((event) => {
    if (!(event.target instanceof HTMLElement) || !rootRef.current?.contains(event.target)) return false;
    const inspected = event.target.closest<HTMLElement>("[data-module-manager-inspect]");
    const expander = event.target.closest<HTMLElement>("[data-module-manager-expand]");
    const header = event.target.closest<HTMLElement>("[data-module-manager-group]");
    const story = event.target.closest<HTMLElement>("[data-module-manager-story]");
    if ((!inspected && !expander && !header && !story) || drillIn) return false;
    const moduleId = inspected?.dataset.moduleManagerInspect ?? expander?.dataset.moduleManagerExpand;
    const groupId = header?.dataset.moduleManagerGroup;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const controls = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-module-manager-group], [data-module-manager-inspect], [data-module-manager-story]"))
        .filter((element) => !element.closest("[hidden]"));
      const cursor = expander ? controls.find((element) => element.dataset.moduleManagerInspect === moduleId) : inspected ?? header ?? story;
      const current = cursor ? controls.indexOf(cursor) : -1;
      const next = controls[Math.max(0, Math.min(controls.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))];
      next?.focus();
      if (next?.dataset.moduleManagerInspect) selectModuleManagerModule(next.dataset.moduleManagerInspect);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (moduleId) setModuleManagerExpanded(moduleId, event.key === "ArrowRight");
      else if (story && event.key === "ArrowLeft") {
        const parent = story.dataset.moduleManagerStoryModule;
        if (parent) {
          setModuleManagerExpanded(parent, false);
          Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-module-manager-inspect]"))
            .find((element) => element.dataset.moduleManagerInspect === parent)?.focus();
        }
      }
      else if (groupId) {
        const group = groups.find(({ id }) => id === groupId);
        if (group && group.expanded !== (event.key === "ArrowRight")) toggleModuleManagerGroup(groupId);
      }
    } else if (event.key === "Enter" && moduleId && inspected) {
      const entry = entries.find(({ module }) => module.id === moduleId);
      if (entry && entry.status !== "hidden" && entry.status !== "archived" && !loading) void act(moduleId, "open");
    } else return false;
    event.preventDefault(); event.stopPropagation(); return true;
  }), [groups, entries, loading, act, drillIn]);

  return <section ref={rootRef} role="region" aria-label="Module Manager" data-module-manager className="flex h-full min-h-0 flex-col bg-pane-bg text-text-primary">
    <header className="flex shrink-0 items-center gap-3 border-b border-pane-border px-5 py-3">
      <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">Modules</h1><p className="truncate text-xs text-text-muted">{projectName || "No project selected"}</p></div>
      {projectId ? <button type="button" data-module-manager-new data-coach-anchor="module-add" onClick={beginModuleManagerCreation} disabled={state.creationActive}
        className="px-2 py-1 text-xs hover:bg-pane-title focus-visible:outline focus-visible:outline-focus-accent disabled:opacity-50">New module</button> : null}
      <button type="button" aria-label="Close Module Manager" onClick={() => closeModuleManager()} className="p-1 text-text-muted hover:bg-pane-title focus-visible:outline focus-visible:outline-focus-accent"><IconX size={16} /></button>
    </header>
    <div hidden={drillIn} className={"relative mx-5 my-3 shrink-0 items-center " + (drillIn ? "hidden" : "flex")}>
      <IconSearch size={13} className="pointer-events-none absolute left-2 text-text-muted" />
      <input ref={searchRef} type="search" aria-label="Search modules" placeholder="Search names, keys, and folders…" value={state.search}
        onChange={(event) => setModuleManagerSearch(event.target.value)}
        className="h-7 w-full border border-transparent bg-pane-title/50 pl-7 pr-7 text-[13px] outline-none placeholder:text-text-muted hover:bg-pane-title focus:border-focus-accent" />
      {state.search ? <button type="button" aria-label="Clear module search" onClick={() => { setModuleManagerSearch(""); searchRef.current?.focus(); }} className="absolute right-2 text-text-muted focus-visible:outline focus-visible:outline-focus-accent"><IconX size={13} /></button> : null}
    </div>
    {loading ? <p role="status" className="px-5 pb-2 text-xs text-text-muted">Loading module eligibility… Navigation is unavailable until this read completes.</p> : null}
    {eligibilityError ? <div role="alert" className="px-5 pb-2 text-xs text-lifecycle-danger">{eligibilityError.message}
      {onRetryEligibility ? <button type="button" aria-label="Retry module eligibility" onClick={onRetryEligibility} className="ml-2 px-2 py-1 underline focus-visible:outline focus-visible:outline-focus-accent">Retry</button> : null}
    </div> : null}
    <div className="flex min-h-0 min-w-0 flex-1">
    <div hidden={drillIn} className={"min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-5 " + (drillIn ? "hidden" : "")}>
      {!projectId ? <p className="text-sm text-text-muted">Choose a project to manage its modules.</p> : groups.map((group) => <section key={group.id} role="region" aria-label={group.title} className="mb-3">
        <button type="button" data-module-manager-group={group.id} aria-expanded={group.expanded} aria-controls={"module-manager-group-" + group.id}
          disabled={group.id === "open" && state.creationActive}
          onClick={() => toggleModuleManagerGroup(group.id)} className="flex w-full items-center gap-2 py-2 text-left text-xs font-medium text-text-muted hover:text-text-primary focus-visible:outline focus-visible:outline-focus-accent">
          <span aria-hidden="true">{group.expanded ? "▾" : "▸"}</span><span>{group.title}</span>
          <span aria-label={state.search.trim() ? group.entries.length + " matching of " + group.total + " modules" : group.total + " modules"}>{state.search.trim() ? group.entries.length + " / " : ""}{group.total}</span>
        </button>
        {group.id === "archived" && archivedLoading ? <p role="status" className="pb-2 text-xs text-text-muted">Loading archived modules…</p> : null}
        {group.id === "archived" && archivedError ? <div role="alert" className="pb-2 text-xs text-lifecycle-danger">{archivedError.message}<button type="button" aria-label="Retry archived modules" onClick={onRetryArchived} className="ml-2 px-2 py-1 underline focus-visible:outline focus-visible:outline-focus-accent">Retry</button></div> : null}
        {group.expanded ? <ul id={"module-manager-group-" + group.id} aria-label={group.title + " modules"}>
          {group.id === "open" ? <li>{state.creationActive ? <InlineModuleCreation key={projectId} /> :
            <button type="button" onClick={beginModuleManagerCreation} className="mb-2 w-full px-2 py-2 text-left text-xs text-text-muted hover:bg-pane-title focus-visible:outline focus-visible:outline-focus-accent"><span aria-hidden="true">+ </span>New module</button>}
          </li> : null}
          {group.entries.map((entry) => <ModuleManagerRow key={entry.module.id} entry={entry} selected={state.selectedModuleId === entry.module.id}
            folder={folders[entry.module.id]} accent={accents[entry.module.id]} loading={loading} pending={!!state.pendingActions[entry.module.id]} error={state.actionErrors[entry.module.id]}
            onInspect={(id) => { if (!drag.consumePostDropClick()) inspectModuleManagerModule(id); }} onAction={(id, action) => { void act(id, action); }}
            dragSourceProps={group.id === "open" && canReorder ? drag.dragSourcePropsFor(entry.module.id) : undefined}
            dropTargetProps={group.id === "open" && canReorder ? drag.dropTargetPropsFor(entry.module.id) : undefined}
            dropIntent={group.id === "open" && canReorder ? drag.dropIntentFor(entry.module.id) : null}
            expanded={!!state.expandedRows[entry.module.id]} onToggleExpanded={(id) => setModuleManagerExpanded(id, !state.expandedRows[id])}
            stories={projectId && state.expandedRows[entry.module.id] ? <ExpandedModuleStories projectId={projectId} moduleId={entry.module.id} moduleName={entry.module.name} /> : undefined} />)}
          {group.entries.length === 0 ? <li className="py-2 text-xs text-text-muted">{state.search.trim() ? "No matching modules" : "No modules"}</li> : null}
        </ul> : null}
      </section>)}
    </div>
    {selectedEntry && (!narrow || drillIn) ? <aside className={"min-h-0 min-w-0 " + (narrow ? "w-full flex-1" : "w-[360px] shrink-0 border-l border-pane-border")}>
      {renderInspection?.(selectedEntry) ?? <ModuleManagerDetail entry={selectedEntry} folder={folders[selectedEntry.module.id]} loading={loading} onBack={narrow ? goBack : undefined} />}
    </aside> : null}
    </div>
  </section>;
}
