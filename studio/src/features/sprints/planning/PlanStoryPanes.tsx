import type { ReactNode } from "react";
import type { PlanGroup } from "./planGroups";
import type { PlanEpic } from "./epicMembership";
import { PlanEmpty, PlanGroupHeading, PlanPane, PlanRow } from "./PlanPane";

export function PlanStoryPanes({ sprintName, activeEpicId, backlog, sprintPane, isPending, openStory, request, openStoryId, suggestions, renderNewStory, renderStoryGoals, backlogFooter, canMove = () => true, incomingMoveHint, activeEpic }: {
  sprintName: string;
  activeEpicId: string | null;
  backlog: PlanGroup[];
  sprintPane: PlanGroup[];
  isPending: (id: string) => boolean;
  openStory: (id: string) => void;
  request: (id: string, into: boolean) => void;
  openStoryId?: string | null;
  suggestions?: ReactNode;
  activeEpic?: PlanEpic;
  renderNewStory?: (epic: PlanEpic, sprint: boolean) => ReactNode;
  renderStoryGoals?: (id: string) => ReactNode;
  backlogFooter?: ReactNode;
  canMove?: (id: string, into: boolean) => boolean;
  incomingMoveHint?: string;
}) {
  const rows = (groups: PlanGroup[], into: boolean) => groups.map(({ epic, items }) => (
    <div key={epic.id} className={into && epic.id !== activeEpicId ? "opacity-50" : undefined}>
      <PlanGroupHeading name={epic.name} />
      {items.length ? items.map((item) => <PlanRow key={item.id} item={item} sign={into ? "−" : "+"}
        pending={isPending(item.id)} selected={openStoryId === item.id} onOpen={openStory}
        moveDisabled={!canMove(item.id, !into)} moveHint={into ? undefined : incomingMoveHint}
        goalChips={into && renderStoryGoals?.(item.id)}
        onMove={() => request(item.id, !into)} />) : <PlanEmpty>Nothing {into ? "planned" : "unplanned"} in {epic.name}.</PlanEmpty>}
      {!into && renderNewStory?.(epic, false)}
    </div>
  ));
  return <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 md:grid-cols-2">
    <PlanPane title="Backlog" testId="plan-backlog" canDropStory={(id) => canMove(id, false)} onDropStory={(id) => request(id, false)}>
      {activeEpicId === null ? <PlanEmpty>No epic open. Use + Add epic to plan another one.</PlanEmpty> : <>{suggestions}{rows(backlog, false)}{backlogFooter}</>}
    </PlanPane>
    <PlanPane title={sprintName} testId="plan-sprint-items" canDropStory={(id) => canMove(id, true)} onDropStory={(id) => request(id, true)}>
      {sprintPane.length ? rows(sprintPane, true) : <PlanEmpty>Nothing planned yet. Pick an epic, then use + or drag a story here.</PlanEmpty>}
      {activeEpic && renderNewStory?.(activeEpic, true)}
    </PlanPane>
  </div>;
}
