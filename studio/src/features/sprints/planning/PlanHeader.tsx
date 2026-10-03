import type { SprintSuggestionExecutionQuery } from "../generated/sprints.documents";

type Goal = NonNullable<SprintSuggestionExecutionQuery["worktrackerSprint"]["nodes"][number]["goals"]>["nodes"][number];

export function PlanHeader({ sprintName, storyCount, goals, waitingCount, agentRunning, onBack, onDone }: {
  sprintName: string;
  storyCount: number;
  goals: Goal[];
  waitingCount: number;
  agentRunning: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  return <header className="flex flex-none items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-pane-border bg-pane-panel px-4 py-2">
    <button type="button" aria-label="Back to sprints" onClick={onBack}
      className="shrink-0 text-sm text-text-secondary hover:text-text-primary">← Plan</button>
    <h1 title={sprintName} className="max-w-64 shrink-0 truncate text-base font-semibold text-text-primary">{sprintName}</h1>
    <span className="shrink-0 text-xs text-text-muted">{storyCount} {storyCount === 1 ? "story" : "stories"}</span>
    <span className="shrink-0 border-l border-pane-border pl-3 text-xs text-text-muted"
      title={goals.map((goal, index) => `G${index + 1}. ${goal.text}`).join("\n")}>
      {goals.length} {goals.length === 1 ? "goal" : "goals"}
    </span>
    {agentRunning ? <span role="status" className="shrink-0 text-xs text-text-muted">Agent still working…</span>
      : waitingCount > 0 && <span className="shrink-0 text-xs text-focus-accent">✦ {waitingCount} to review</span>}
    <button type="button" onClick={onDone}
      className="ml-auto h-7 shrink-0 border border-focus-accent bg-focus-accent px-2 text-sm font-semibold text-pane-bg">Done</button>
  </header>;
}
