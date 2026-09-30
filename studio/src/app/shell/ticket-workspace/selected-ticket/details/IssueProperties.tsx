import type { WorkItem } from "../../../../../shared/api/types";
import type { BlockerChip } from "../../../../../features/work-items";
import BlockerChipView from "./BlockerChipView";
import Field from "./Field";
import BlockerPicker from "./fields/BlockerPicker";

interface IssuePropertiesProps {
  task: WorkItem;
  saving: Record<string, boolean>;
  blockedByChips: BlockerChip[];
  blocksChips: BlockerChip[];
  items: WorkItem[];
  addBlocker: (id: string) => void;
  removeBlocker: (id: string) => void;
}

/**
 * Dependency metadata under the title. Type, state and parent live in the
 * toolbar and breadcrumb.
 */
export default function IssueProperties({
  task,
  saving,
  blockedByChips,
  blocksChips,
  items,
  addBlocker,
  removeBlocker,
}: IssuePropertiesProps) {
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-pane-border py-2 text-sm"
      data-testid="details-fields"
    >
      <Field label="Blocked by" saving={Boolean(saving.blocked_by_ids)}>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="blocked-by-row">
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
        <Field label="Blocks">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="blocks-row">
            {blocksChips.map((chip) => (
              <BlockerChipView key={chip.id} chip={chip} />
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}
