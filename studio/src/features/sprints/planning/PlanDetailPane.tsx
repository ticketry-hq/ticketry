import type { ReactNode } from "react";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { SuggestionBanner } from "./SuggestionBanner";
import { ProposedStoryDraft } from "./ProposedStoryDraft";
import { PlanDetailContent, PlanDetailFrame } from "./PlanDetailFrame";

export function PlanDetailPane({ openItem, suggestions, goals = [], epics = [], sprintName = "", busy, acceptDisabled = false, dismissDisabled = false, renderWorkItemDetail, onAccept, onDismiss, onClose }: {
  openItem: string | null;
  suggestions: SprintSuggestionRecordFragment[];
  goals?: readonly { id: string; text: string; position: number }[];
  epics?: readonly { id: string; name: string }[];
  sprintName?: string;
  busy: boolean;
  acceptDisabled?: boolean;
  dismissDisabled?: boolean;
  renderWorkItemDetail: (id: string) => ReactNode;
  onAccept: (suggestion: SprintSuggestionRecordFragment, proposedName?: string) => void;
  onDismiss: (suggestion: SprintSuggestionRecordFragment) => void;
  onClose: () => void;
}) {
  if (!openItem) return null;
  const suggestion = openItem.startsWith("suggestion:")
    ? suggestions.find((candidate) => `suggestion:${candidate.id}` === openItem) : null;
  const issueId = suggestion?.status === "accepted" && suggestion.proposedName !== null
    ? null : suggestion?.issueId;
  const detailBusy = busy || Boolean(suggestion && suggestion.status !== "waiting");
  return <PlanDetailFrame openItem={openItem} onClose={onClose}>
    <PlanDetailContent key={`${openItem}:${issueId ?? "draft"}`}>
      {suggestion ? issueId ? <>
        <SuggestionBanner suggestion={suggestion} goals={goals} busy={detailBusy} acceptDisabled={acceptDisabled} dismissDisabled={dismissDisabled} onAccept={onAccept} onDismiss={onDismiss} />
        {renderWorkItemDetail(issueId)}
      </> : <ProposedStoryDraft suggestion={suggestion} goals={goals} busy={detailBusy} acceptDisabled={acceptDisabled} dismissDisabled={dismissDisabled}
        epicName={epics.find((epic) => epic.id === suggestion.proposedEpicId)?.name ?? "No epic"}
        sprintName={sprintName} onAccept={onAccept} onDismiss={onDismiss} />
      : !openItem.startsWith("suggestion:") && renderWorkItemDetail(openItem)}
    </PlanDetailContent>
  </PlanDetailFrame>;
}
