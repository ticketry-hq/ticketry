import type { ActiveWorktree } from "@worktracker/typescript-sdk/models";
import type { ShipRecord } from "@worktracker/typescript-sdk/models";
import { useModuleShipRecordsQuery } from "../source-control";
import { ShipHistory } from "./ShipHistory";
import { useModuleWorktreesQuery } from "./queries";

interface WorktreesViewProps {
  projectId: string;
  moduleId: string;
}

export function WorktreesView({ projectId, moduleId }: WorktreesViewProps) {
  const worktrees = useModuleWorktreesQuery(projectId, moduleId);
  const shipRecords = useModuleShipRecordsQuery(projectId, moduleId);
  const records = shipRecords.data ?? [];
  const baseRecords = records.filter(
    (record) => record.checkout_kind === "base",
  );

  return (
    <div
      aria-label="Worktrees view"
      data-testid="worktrees-view"
      className="p-2 text-xs text-text-primary"
    >
      {shipRecords.isPending ? (
        <div
          role="status"
          aria-label="Loading module ship history"
          className="mb-2 px-2 py-1 text-text-muted"
        >
          Loading ship history...
        </div>
      ) : shipRecords.isError ? (
        <div
          role="alert"
          aria-label="Module ship history read error"
          className="mb-2 border border-lifecycle-danger px-2 py-1 text-lifecycle-danger"
        >
          Could not load ship history.
        </div>
      ) : null}
      <ol aria-label="Module checkouts" className="space-y-2">
        <BaseCheckoutRow
          projectId={projectId}
          moduleId={moduleId}
          records={shipRecords.isSuccess ? baseRecords : null}
        />
        {worktrees.isPending ? (
          <li
            role="status"
            aria-label="Loading active task worktrees"
            className="px-2 py-1 text-text-muted"
          >
            Loading active task worktrees...
          </li>
        ) : worktrees.isError ? (
          <li
            role="alert"
            aria-label="Active task worktrees read error"
            className="border border-lifecycle-danger px-2 py-1 text-lifecycle-danger"
          >
            Could not load active task worktrees.
          </li>
        ) : worktrees.data.length === 0 ? (
          <li
            role="status"
            aria-label="No active task worktrees"
            className="px-2 py-1 text-text-muted"
          >
            No active task worktrees.
          </li>
        ) : (
          worktrees.data.map((worktree) => (
            <TaskWorktreeRow
              key={worktree.id}
              projectId={projectId}
              moduleId={moduleId}
              worktree={worktree}
              records={
                shipRecords.isSuccess
                  ? records.filter(
                      (record) => record.task_id === worktree.task_id,
                    )
                  : null
              }
            />
          ))
        )}
      </ol>
    </div>
  );
}

function BaseCheckoutRow({
  projectId,
  moduleId,
  records,
}: {
  projectId: string;
  moduleId: string;
  records: readonly ShipRecord[] | null;
}) {
  return (
    <li
      aria-label={`Base checkout for module ${moduleId}`}
      data-checkout-kind="base"
      className="border border-pane-border bg-pane-bg/40 p-2"
    >
      <div className="font-medium">Base checkout</div>
      <div className="mt-1 text-text-muted">Selected module</div>
      {records ? (
        <ShipHistory
          projectId={projectId}
          moduleId={moduleId}
          checkoutLabel="Base checkout"
          records={records}
        />
      ) : null}
    </li>
  );
}

function TaskWorktreeRow({
  projectId,
  moduleId,
  worktree,
  records,
}: {
  projectId: string;
  moduleId: string;
  worktree: ActiveWorktree;
  records: readonly ShipRecord[] | null;
}) {
  const taskLabel = worktree.ticket_seq
    ? `Task #${worktree.ticket_seq}`
    : "Task worktree";
  const stateLabel = worktree.status === "conflict" ? "Conflict" : "Active";

  return (
    <li
      aria-label={`Task worktree ${worktree.task_id}`}
      data-checkout-kind="worktree"
      className="border border-pane-border bg-pane-bg/40 p-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{taskLabel}</span>
        <span className="text-text-muted">{stateLabel}</span>
      </div>
      <div className="mt-1 truncate font-mono" title={worktree.branch}>
        {worktree.branch}
      </div>
      <div className="mt-1 truncate text-text-muted" title={worktree.path}>
        Base: {worktree.base_branch}
      </div>
      {records ? (
        <ShipHistory
          projectId={projectId}
          moduleId={moduleId}
          checkoutLabel={taskLabel}
          records={records}
        />
      ) : null}
    </li>
  );
}
