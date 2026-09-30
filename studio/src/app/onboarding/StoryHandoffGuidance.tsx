import { useWorkItem } from "../../features/work-items";
import {
  useProjectWorkflowSettings,
  useProviderCatalogQuery,
} from "../../features/workflows";

/** The first saved Story's next step, based on the same live catalog as the guide. */
export function StoryHandoffGuidance({ storyId }: { storyId: string }) {
  const { data: story } = useWorkItem(storyId);
  return (
    <div className="space-y-2 text-sm leading-5 text-text-secondary">
      <p>
        Capturing this Story saved your work; it did not start an agent. Open
        Details to describe the desired result and what would count as finished.
      </p>
      {story?.project_id && story.state ? (
        <StoryLaunchGuidance
          projectId={story.project_id}
          issueTypeId={story.issue_type}
          stateId={story.state}
        />
      ) : (
        <p role="status">Checking this Story&apos;s launch configuration…</p>
      )}
    </div>
  );
}

function StoryLaunchGuidance({
  projectId,
  issueTypeId,
  stateId,
}: {
  projectId: string;
  issueTypeId: string;
  stateId: string;
}) {
  const workflows = useProjectWorkflowSettings(projectId);
  const providers = useProviderCatalogQuery();
  const workflow = workflows[issueTypeId];
  const hasCurrentBinding = workflow?.launch_bindings.some(
    (binding) => binding.state_id === stateId,
  );

  return (
    <>
      {providers.isError ? (
        <p role="status">
          Provider configuration could not load. You can still edit this Story
          and finish the tour. Check Settings &gt; Model configuration later.
        </p>
      ) : !providers.data ? (
        <p role="status">Checking provider configuration…</p>
      ) : providers.data.activated_providers.length === 0 ? (
        <p>
          You can keep editing and organizing work without an agent. Configure
          agents later in Settings &gt; Model configuration.
        </p>
      ) : hasCurrentBinding ? (
        <p>
          Run item starts configured work for this Story&apos;s current stage.
          A launch binding is configured, but launch still depends on the
          executable, login, profile, and backend checks.
        </p>
      ) : workflow ? (
        <p>
          This stage needs launch configuration before Run item can start it.
          Check Settings &gt; Model configuration and the stage&apos;s launch binding.
          An activated provider alone does not make a run ready.
        </p>
      ) : (
        <p role="status">
          Checking this stage&apos;s launch configuration. Use the Story workflow
          guide for details; an activated provider alone does not make a run ready.
        </p>
      )}
    </>
  );
}
