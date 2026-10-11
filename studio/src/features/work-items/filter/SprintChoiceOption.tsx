import type { StorySprintIntent } from "../internal/storySprintFilterStore";

export interface BasicSprintChoice {
  label: string;
  status?: string;
  count?: number;
  intent: StorySprintIntent;
  selected: boolean;
}

export function SprintChoiceOption({ choice, onChoose, tabIndex, onFocus }: {
  choice: BasicSprintChoice;
  onChoose: (intent: StorySprintIntent) => void;
  tabIndex: number;
  onFocus?: () => void;
}) {
  return <button type="button" role="option" aria-selected={choice.selected} tabIndex={tabIndex}
    onFocus={onFocus} onClick={() => onChoose(choice.intent)}
    className="flex w-full min-w-0 items-center gap-2 px-2 py-2 text-left text-xs text-text-primary hover:bg-pane-title focus:bg-pane-title focus:outline focus:outline-1 focus:outline-focus-accent">
    <span className="min-w-0 flex-1 truncate" title={choice.label}>{choice.label}</span>
    {choice.status ? <span className="text-[10px] capitalize text-text-muted">{choice.status}</span> : null}
    {choice.count !== undefined ? <span className="text-text-muted">{choice.count}</span> : null}
  </button>;
}
