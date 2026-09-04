import { type ReactNode } from "react";
import {
  type IssueType,
  type Module,
  type WorkItem,
} from "../../../../../shared/api/types";
import {
  type BlockerChip,
  formatWorkItemDisplayIdentifier,
} from "../../../../../features/work-items";
import ParentPicker from "./fields/ParentPicker";
import BlockerPicker from "./fields/BlockerPicker";
import { formatDate } from "../../../../../shared/utilities/display";
import Field from "./Field";
import BlockerChipView from "./BlockerChipView";
import IssueTypePicker from "./fields/IssueTypePicker";
import { WorktreeBlock } from "../../../../../features/agents/worktrees";

interface IssueSidebarProps {
  task: WorkItem;
  epic: Module | null;
  saving: Record<string, boolean>;
  blockedByChips: BlockerChip[];
  blocksChips: BlockerChip[];
  items: WorkItem[];
  setIssueType: (issueType: IssueType) => void;
  setParent: (parentId: string | null) => void;
  addBlocker: (id: string) => void;
  removeBlocker: (id: string) => void;
  goEpic: () => void;
  actions?: ReactNode;
}

export default function IssueSidebar({
  task,
  epic,
  saving,
  blockedByChips,
  blocksChips,
  items,
  setIssueType,
  setParent,
  addBlocker,
  removeBlocker,
  goEpic,
  actions,
}: IssueSidebarProps) {
  return (
    <div
      className="overflow-y-auto border-l border-pane-border bg-pane-bg/40 p-4"
      data-testid="details-panel"
    >
      <div
        className="flex min-h-7 items-center justify-between gap-3"
        data-testid="details-header"
      >
        <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          Details
        </div>
        <div className="ml-auto flex items-center justify-end" data-testid="details-actions">
          {actions}
        </div>
      </div>

      <div className="mt-2 divide-y divide-pane-border/60" data-testid="details-fields">
        <Field label="Type" saving={Boolean(saving.issue_type_id)}>
          <IssueTypePicker
            projectId={task.project_id}
            value={task.issue_type}
            saving={Boolean(saving.issue_type_id)}
            onChange={setIssueType}
          />
        </Field>
        <Field label="Parent" saving={Boolean(saving.parent_id)}>
          <ParentPicker
            value={task.parent_id}
            currentId={task.id}
            items={items}
            saving={Boolean(saving.parent_id)}
            onChange={setParent}
          />
        </Field>
        <Field label="Module">
          {epic ? (
            <button
              type="button"
              onClick={goEpic}
              data-testid="epic-link"
              className="font-mono text-sm text-focus-accent hover:underline"
            >
              {formatWorkItemDisplayIdentifier(epic.sequence_id)}
            </button>
          ) : (
            <span className="text-sm text-text-muted">—</span>
          )}
        </Field>
        {/* Blockers (#624): editable Blocked-by + read-only reverse Blocks. */}
        <Field
          label="Blocked by"
          arrangement="stacked"
          saving={Boolean(saving.blocked_by_ids)}
        >
          <div className="flex flex-wrap gap-1.5" data-testid="blocked-by-row">
            {blockedByChips.map((chip) => (
              <BlockerChipView
                key={chip.id}
                chip={chip}
                onRemove={() => removeBlocker(chip.id)}
                disabled={Boolean(saving.blocked_by_ids)}
              />
            ))}
            <BlockerPicker
              issueId={task.id}
              projectId={task.project_id}
              items={items}
              currentIds={task.blocked_by_ids}
              onPick={addBlocker}
              saving={Boolean(saving.blocked_by_ids)}
            />
          </div>
        </Field>

        {blocksChips.length > 0 && (
          <Field label="Blocks" arrangement="stacked">
            <div className="flex flex-wrap gap-1.5" data-testid="blocks-row">
              {blocksChips.map((chip) => (
                <BlockerChipView key={chip.id} chip={chip} />
              ))}
            </div>
          </Field>
        )}

        <Field label="Created" muted>
          <span className="text-sm text-text-muted" data-testid="created-at">
            {formatDate(task.created_at)}
          </span>
        </Field>
        <Field label="Updated" muted>
          <span className="text-sm text-text-muted" data-testid="updated-at">
            {formatDate(task.updated_at)}
          </span>
        </Field>
      </div>

      <WorktreeBlock taskId={task.id} />
    </div>
  );
}
