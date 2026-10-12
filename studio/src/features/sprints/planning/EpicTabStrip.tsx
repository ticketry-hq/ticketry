import NewEpicChip from "./NewEpicChip";
import { useLayoutEffect, useRef } from "react";
import type { PlanningGraph } from "../../planning-graph";
import Popover, { PopoverOption } from "../../../shared/ui/Popover";
import { TabStrip } from "../../../shared/ui/TabStrip";
import { usePlanWorkspace } from "../planWorkspaceState";
import type { PlanVisitCoordinator } from "./usePlanVisitCoordinator";

interface EpicTabStripProps { graph: PlanningGraph; coordinator: PlanVisitCoordinator }

export function EpicTabStrip({ graph, coordinator }: EpicTabStripProps) {
  const { visit, epics, label, select } = coordinator;
  const stripRef = useRef<HTMLDivElement>(null);
  const addEpicRef = useRef<HTMLButtonElement>(null);
  const previousTabCount = useRef(visit.epicTabs.length);
  useLayoutEffect(() => {
    const focus = document.activeElement;
    const ownedFocus = focus === document.body || stripRef.current?.contains(focus);
    if (previousTabCount.current > 0 && visit.epicTabs.length === 0 && ownedFocus) addEpicRef.current?.focus();
    previousTabCount.current = visit.epicTabs.length;
  }, [visit.epicTabs.length]);
  return <div ref={stripRef} className="flex shrink-0 items-center border-b border-pane-border bg-pane-title">
    <TabStrip label="Plan epic tabs" activeId={visit.activeEpicId} onSelect={select} onClose={(epicId) => {
      if (coordinator.close(epicId, "tab") && visit.epicTabs.length === 1) addEpicRef.current?.focus();
    }} tabs={visit.epicTabs.map((id) => {
      const text = label(id);
      return { id, label: <>{text.name} <span className="text-text-muted">{text.count}{text.waiting ? ` ✦ ${text.waiting}` : ""}</span></>, accessibleLabel: text.accessible, closeLabel: `Close ${text.name}` };
    })} />
    <Popover trigger={({ open, onClick }) => <button type="button" ref={addEpicRef} aria-label="Add epic" aria-expanded={open} onClick={onClick} className="whitespace-nowrap px-3 py-1 text-text-secondary">+ Add epic</button>}>
      {(close) => <>{epics.filter((epic) => !visit.epicTabs.includes(epic.id)).map((epic) => {
        const text = label(epic.id);
        return <PopoverOption key={epic.id} onClick={() => { select(epic.id); close(); }}><span aria-label={text.accessible}>{text.name}, {text.count} backlog stories{text.waiting ? `, ${text.waiting} waiting suggestions` : ""}</span></PopoverOption>;
      })}{graph.project && <NewEpicChip projectId={graph.project.id} epicType={graph.epicType} onCreated={(id) => {
        const owner = stripRef.current;
        const ownedFocus = document.activeElement === document.body || owner?.contains(document.activeElement);
        if (!coordinator.created(id)) return;
        close();
        if (!ownedFocus) return;
        requestAnimationFrame(() => {
          const workspace = usePlanWorkspace.getState();
          if (!coordinator.isCurrent() || !owner?.isConnected || !workspace.sprintId || workspace.visits[workspace.sprintId]?.activeEpicId !== id) return;
          if (document.activeElement !== document.body && !owner.contains(document.activeElement)) return;
          owner.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
        });
      }} />}</>}
    </Popover>
    <button type="button" aria-label="Next epic" disabled={visit.epicTabs.length < 2} onClick={() => coordinator.next()} className="ml-auto whitespace-nowrap px-3 py-1 text-text-secondary disabled:opacity-40">Next epic →</button>
  </div>;
}
