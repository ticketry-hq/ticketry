import { skipToken, useQuery } from "@apollo/client/react";
import { useEffect, useMemo, useRef } from "react";
import { WorkTrackerProjectOpenDocument } from "../projects";
import { useWorkItem } from "../work-items";
import { useClientStore } from "../../state/clientStore";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { useProviderCatalogQuery } from "./providerQueries";
import { normalizedCatalog } from "./queries/projectCatalog";
import { workflowSettingsFromCatalog } from "./queries/readTransport";
import { StoryWorkflowGuideStages } from "./StoryWorkflowGuideStages";

/** Guide body; the app modal host supplies the shell and close behaviour. */
export function StoryWorkflowGuideDialog({
  storyId,
  onClose,
  onDismiss,
}: {
  storyId: string;
  /** User-initiated close; returns focus to the invoking control. */
  onClose: () => void;
  /** Silent removal when the Story is deselected, evicted, or retyped. */
  onDismiss: () => void;
}) {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const { data: story } = useWorkItem(storyId);
  const seenStory = useRef(false);
  const projectId = story?.project_id ?? null;
  const projectQuery = useQuery(
    WorkTrackerProjectOpenDocument,
    projectId ? {
      client: studioApolloClient(),
      variables: { projectId: compactWorktrackerId(projectId) },
      fetchPolicy: "cache-and-network",
      nextFetchPolicy: "cache-first",
    } : skipToken,
  );
  const providerQuery = useProviderCatalogQuery();

  useEffect(() => {
    if (selectedTaskId !== storyId) onDismiss();
  }, [onDismiss, selectedTaskId, storyId]);
  useEffect(() => {
    if (story) seenStory.current = true;
    else if (seenStory.current) onDismiss();
  }, [onDismiss, story]);

  const projectData = projectQuery.data?.project.nodes.some(
    (project) => publicWorktrackerId(project.id) === projectId,
  ) ? projectQuery.data : undefined;
  const catalog = useMemo(
    () => projectData ? normalizedCatalog(projectData) : null,
    [projectData],
  );
  const issueType = catalog?.issueTypes.find(
    (candidate) => publicWorktrackerId(candidate.id) === story?.issue_type,
  );
  useEffect(() => {
    if (issueType && issueType.name !== "Story") onDismiss();
  }, [issueType, onDismiss]);
  const workflow = useMemo(() => {
    if (!catalog || !story || !issueType) return null;
    return workflowSettingsFromCatalog(catalog, story.issue_type);
  }, [catalog, issueType, story]);
  const provider = providerQuery.data;
  const currentBinding = workflow?.launch_bindings.find(
    (binding) => binding.state_id === story?.state,
  );
  const loadingWorkflow = !projectQuery.error && !workflow && (projectQuery.loading || !story);
  const missingWorkflow = !projectQuery.error && !workflow && !loadingWorkflow;

  // Hide old content in the render that observes a selection change or eviction;
  // the effects above then remove its modal descriptor.
  if (selectedTaskId !== storyId || (seenStory.current && !story) || (issueType && issueType.name !== "Story")) return null;

  return (
    <div className="min-w-0 space-y-5 break-words text-text-primary">
      {story && <p className="text-sm text-text-muted">For Story: {story.name}</p>}
      <section aria-labelledby="story-guide-next-step" className="space-y-2">
        <h3 id="story-guide-next-step" className="text-base font-semibold">Next step</h3>
        <p className="text-sm">
          Open Details and describe the desired result and what would count as finished.
          Capturing a Story saves it; it does not start an agent.
        </p>
        {providerQuery.isError ? (
          <div role="alert" className="text-sm text-lifecycle-danger">
            Provider configuration could not load. <button type="button" className="underline" onClick={() => void providerQuery.refetch()}>Retry provider configuration</button>
          </div>
        ) : provider ? (
          provider.activated_providers.length === 0 ? (
            <p className="text-sm">
              You can keep editing and organizing work without an agent. Configure
              agents later in Settings &gt; Model configuration.
            </p>
          ) : (
            <p className="text-sm">
              Run item starts configured work for the current stage when a launch
              binding exists. {currentBinding
                ? "This stage has a launch binding."
                : workflow ? "This stage needs launch configuration before Run item can start it." : "Check this stage’s launch binding below."}
              {" "}An activated provider alone does not guarantee an executable installation,
              login, valid profile, or successful launch. Existing availability checks still apply.
            </p>
          )
        ) : (
          <p role="status" className="text-sm text-text-muted">Loading provider configuration…</p>
        )}
        {Boolean(provider?.activated_providers.length) && !provider?.global_default && (
          <p className="text-sm text-text-muted">
            No global launch default is configured. A stage that relies on the default
            may need configuration even with an activated provider.
          </p>
        )}
      </section>

      <section aria-labelledby="story-guide-workflow" className="min-w-0 space-y-2">
        <h3 id="story-guide-workflow" className="text-base font-semibold">This Story&apos;s workflow</h3>
        {projectQuery.error ? (
          <div role="alert" className="text-sm text-lifecycle-danger">
            Workflow configuration could not load. <button type="button" className="underline" onClick={() => void projectQuery.refetch()}>Retry</button>
          </div>
        ) : loadingWorkflow ? (
          <p role="status" className="text-sm text-text-muted">Loading workflow…</p>
        ) : missingWorkflow ? (
          <div role="alert" className="text-sm text-lifecycle-danger">
            This Story&apos;s workflow configuration is unavailable. <button type="button" className="underline" onClick={() => void projectQuery.refetch()}>Retry</button>
          </div>
        ) : workflow && catalog && story ? (
          <StoryWorkflowGuideStages
            workflow={workflow}
            states={catalog.states}
            currentStateId={story.state}
          />
        ) : null}
      </section>

      <section aria-labelledby="story-guide-controls" className="space-y-2 text-sm">
        <h3 id="story-guide-controls" className="text-base font-semibold">Launch controls</h3>
        <p>Availability depends on the selected Story and its configuration. This guide does not start work.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Run now</strong> preflights an eligible Story, then moves it to Implement and launches an agent. This skips the usual planning stages and may be unavailable or fail checks.</li>
          <li><strong>Run item</strong> starts a new task-scoped agent run with the current stage&apos;s configured instructions and launch policy. It does not itself choose a new stage; an agent may later make permitted transitions. <strong>Run subtree</strong> is a separate action for a Story and its descendants.</li>
          <li><strong>+ Agent</strong> opens a chooser without launching. Choosing a provider starts an agent session. Choosing <strong>Terminal</strong> opens a shell in the module context, not a coding agent.</li>
        </ul>
      </section>

      <section aria-labelledby="story-guide-results" className="space-y-2 text-sm">
        <h3 id="story-guide-results" className="text-base font-semibold">Finding results</h3>
        <p>Existing run indicators show progress and status. The Story&apos;s agent terminal tabs contain agent output and conversation.</p>
        <p><strong>Changes</strong> shows code differences when a task checkout is available. Until then, there may be no Changes view or code changes to inspect. The Review workflow stage is separate from the Changes view. A completed run does not approve its result.</p>
      </section>

      <div className="flex justify-end border-t border-pane-border pt-3">
        <button type="button" onClick={onClose} className="border border-pane-border px-3 py-1.5 text-sm hover:bg-pane-title">Close</button>
      </div>
      </div>
  );
}
