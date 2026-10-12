import { StorySprintFilter } from "./StorySprintFilter";
import { editionHas } from "../../../shared/config/edition";
import { openModuleManager } from "../../module-manager/state";

/** Project-level controls remain reachable without any selected module. */
export function SprintModuleRecovery({ noMatches, hiddenMatches = false }: { noMatches: boolean; hiddenMatches?: boolean }) {
  return <section aria-label={editionHas("sprintPlanning") ? "Sprint module recovery" : "Module selection"} className="max-w-md p-3">
    <StorySprintFilter matchingRootCount={0} totalRootCount={0} />
    <p role="status" className="text-sm text-text-muted">
      {editionHas("sprintPlanning") && noMatches ? hiddenMatches ? "All matching module tabs are hidden." : "No modules have stories in this sprint." : "Select a module to view its stories."}
    </p>
    <button type="button" onClick={() => openModuleManager()}
      className="mt-2 border border-pane-border px-2 py-1 text-xs hover:bg-pane-title focus-visible:outline focus-visible:outline-focus-accent">Manage modules</button>
  </section>;
}
