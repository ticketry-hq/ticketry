import { createApolloStore } from "../../../shared/apollo/localState";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { SuggestionBanner } from "./SuggestionBanner";

const useProposalTitles = createApolloStore<{ titles: Record<string, string> }>(
  "plan-proposal-titles", () => ({ titles: {} }),
);

export function editedProposalTitle(id: string): string | undefined {
  return useProposalTitles.getState().titles[id];
}

export function clearProposalTitle(id: string): void {
  useProposalTitles.setState(({ titles }) => ({ titles: Object.fromEntries(Object.entries(titles).filter(([key]) => key !== id)) }));
}

export function ProposedStoryDraft({ suggestion, goals, epicName, sprintName, busy, acceptDisabled = false, dismissDisabled = false, onAccept, onDismiss }: {
  suggestion: SprintSuggestionRecordFragment;
  goals: readonly { id: string; text: string; position: number }[];
  epicName: string;
  sprintName: string;
  busy: boolean;
  acceptDisabled?: boolean;
  dismissDisabled?: boolean;
  onAccept: (suggestion: SprintSuggestionRecordFragment, proposedName: string) => void;
  onDismiss: (suggestion: SprintSuggestionRecordFragment) => void;
}) {
  const editedTitle = useProposalTitles((state) => state.titles[suggestion.id]);
  const title = editedTitle ?? suggestion.proposedName ?? "";
  const trimmed = title.trim();
  const valid = trimmed.length > 0 && Array.from(trimmed).length <= 512;
  return <>
    <SuggestionBanner suggestion={suggestion} goals={goals} busy={busy} acceptDisabled={acceptDisabled || !valid}
      dismissDisabled={dismissDisabled} onAccept={() => onAccept(suggestion, trimmed)} onDismiss={onDismiss} />
    <div aria-label="Proposed story" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm text-text-primary">
      <label className="flex flex-col gap-1">Title
        <input aria-label="Title" value={title} disabled={busy}
          className="border border-pane-border bg-pane-bg px-2 py-1 text-text-primary"
          onChange={(event) => {
            const value = event.target.value;
            useProposalTitles.setState(({ titles }) => ({ titles: { ...titles, [suggestion.id]: value } }));
          }} />
      </label>
      <label className="flex flex-col gap-1">Epic
        <input aria-label="Epic" readOnly value={epicName} className="bg-transparent text-text-secondary" />
      </label>
      <label className="flex flex-col gap-1">Sprint
        <input aria-label="Sprint" readOnly value={sprintName} className="bg-transparent text-text-secondary" />
      </label>
    </div>
  </>;
}
