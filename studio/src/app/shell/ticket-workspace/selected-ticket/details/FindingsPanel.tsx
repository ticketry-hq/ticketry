import { type WorkItem } from "../../../../../shared/api/types";
import { stateColor, stateLabel } from "../../../../../shared/utilities/display";
import { useClientStore } from "../../../../../state/clientStore";
import { useCachedStates, stateById } from "../../../../../features/projects";
import { useIssueTypesQuery } from "../../../../../features/settings";
import { formatWorkItemDisplayIdentifier } from "../../../../../features/work-items";
import {
  findings as selectFindings,
  queuedFindingCount,
  formatFindingLocation,
  isCancellable,
} from "./internal/findings";

interface FindingsPanelProps {
  children: WorkItem[];
  projectId: string;
  onCancel: (childId: string) => void;
}

// CODIN-907: the review-findings panel on a Story in Review. Lists the Story's
// direct Implementation children (findings the integration-review agent filed
// via CODIN-905) with key, title, state chip, and parsed location, plus a
// "N fixes queued" count of the ones at the Implementation start stage.
// Open/edit selects the child in the Studio task store; cancel reuses the child
// state-move mutation, after which the parent detail reconciles.
export default function FindingsPanel({ children, projectId, onCancel }: FindingsPanelProps) {
  const selectTask = useClientStore((state) => state.selectTask);
  const states = useCachedStates(projectId);
  const issueTypes = useIssueTypesQuery(projectId).data ?? [];
  const implementationTypeId = issueTypes.find((type) => type.name === "Implementation")?.id ?? null;
  const implementStateId = states.find((state) => state.name === "Implement")?.id ?? null;
  const items = selectFindings(children, implementationTypeId);
  const queued = queuedFindingCount(children, implementationTypeId, implementStateId);

  if (items.length === 0) return null;

  return (
    <div className="mt-8" data-testid="findings-panel">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-text-secondary">
          Review findings
        </span>
        <span
          className="bg-pane-title px-2 py-0.5 text-xs text-text-secondary"
          data-testid="findings-queued-count"
        >
          {queued} {queued === 1 ? "fix" : "fixes"} queued
        </span>
      </div>
      <div className="overflow-hidden border border-pane-border" data-testid="findings-list">
        {items.map((f) => {
          const location = formatFindingLocation(f.description);
          const state = stateById(states, f.state);
          const identifier = formatWorkItemDisplayIdentifier(f.sequence_id);
          return (
            <div
              key={f.id}
              data-testid="finding-row"
              className="flex items-center gap-2.5 border-b border-pane-border/60 px-3 py-2 last:border-b-0 hover:bg-pane-title"
            >
              <button
                type="button"
                onClick={() => void selectTask(f.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="w-20 flex-none font-mono text-xs text-text-muted">
                  {identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-base text-text-primary">{f.name}</span>
                {location && (
                  <span
                    className="hidden flex-none truncate font-mono text-xs text-text-muted sm:inline"
                    data-testid="finding-location"
                    title={location}
                  >
                    {location}
                  </span>
                )}
              </button>
              <span
                className="flex-none px-1.5 py-0.5 text-xs"
                data-testid="finding-state"
                style={{ color: stateColor(state), backgroundColor: `${stateColor(state)}22` }}
              >
                {stateLabel(state)}
              </span>
              {isCancellable(f, states) && (
                <button
                  type="button"
                  onClick={() => onCancel(f.id)}
                  data-testid="finding-cancel"
                  aria-label={identifier ? `Cancel ${identifier}` : "Cancel finding"}
                  title="Cancel finding"
                  className="flex-none px-1.5 py-0.5 text-xs text-text-muted hover:bg-pane-bg hover:text-lifecycle-danger"
                >
                  Cancel
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
