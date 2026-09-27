import { useMemo } from "react";
import type { ScopedWorkflowSettings, State } from "../../shared/api/types";
import { storyGuideStages, type StoryGuideStage } from "./storyGuideStages";

function StageEntry({ stage }: { stage: StoryGuideStage }) {
  return (
    <li className="min-w-0 border border-pane-border p-3" data-state-id={stage.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="min-w-0 break-words font-semibold">{stage.name}</h4>
        {stage.current && <span className="text-xs text-text-muted">Current state</span>}
      </div>
      {stage.outsideConfiguration && (
        <p className="mt-1 text-sm text-lifecycle-danger">
          Current state is outside this Story&apos;s configured workflow.
        </p>
      )}
      <p className="mt-1 text-sm text-text-muted">
        {stage.meaning
          ? `Common meaning: ${stage.meaning}. Configured instructions govern this stage.`
          : "Custom stage. Its configured instructions define what happens here."}
      </p>
      {stage.example && <p className="mt-1 text-sm">Saved-notes search example: {stage.example}</p>}
      <p className="mt-2 text-sm">
        {stage.destinations.length
          ? `Next: ${stage.destinations.map((destination) => destination.name).join(", ")}.`
          : "No outgoing transitions configured."}
      </p>
      <p className="mt-1 text-sm">
        Launch binding: {stage.binding ? "Configured" : "Not configured"}. Entry auto-start: {stage.binding?.auto_start ? "On" : "Off"}.
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer">Stage instructions</summary>
        <pre className="mt-2 max-w-full whitespace-pre-wrap break-words bg-pane-title p-2 text-sm">
          {stage.binding?.prompt.trim() ? stage.binding.prompt : "No agent instructions configured."}
        </pre>
      </details>
    </li>
  );
}

export function StoryWorkflowGuideStages({
  workflow,
  states,
  currentStateId,
}: {
  workflow: ScopedWorkflowSettings;
  states: State[];
  currentStateId: string | null;
}) {
  const stages = useMemo(
    () => storyGuideStages(workflow, states, currentStateId),
    [workflow, states, currentStateId],
  );
  return (
    <>
      <p className="text-sm text-text-muted">
        These are this Story type&apos;s configured states. Their order is for display;
        the listed destinations are the actual transitions. Familiar labels have
        common meanings, but each stage&apos;s configured instructions govern its work.
      </p>
      {stages.length ? (
        <ol className="mt-3 space-y-2">
          {stages.map((stage) => <StageEntry key={stage.id} stage={stage} />)}
        </ol>
      ) : (
        <p className="mt-2 text-sm">No states are configured for this Story type.</p>
      )}
      <p className="mt-3 text-sm text-text-muted">
        Use the existing state control to move this Story. A state move can start or
        continue agent work when policy is configured. Agent handoff settings apply
        to an agent already running; they do not mean every manual state move launches.
      </p>
    </>
  );
}
