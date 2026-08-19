import {
  issueTypeById,
  useIssueTypesQuery,
} from "../../../../../../features/settings";
import type { IssueType } from "../../../../../../shared/api/types";
import { IssueTypeLabel } from "../../../../../../shared/ui/IssueTypeLabel";
import Popover, { PopoverOption } from "./Popover";
import PopoverContent from "./PopoverContent";
import PickerTrigger from "./PickerTrigger";

const EMPTY_ISSUE_TYPES: IssueType[] = [];

interface IssueTypePickerProps {
  projectId: string;
  value: string;
  saving?: boolean;
  onChange: (issueType: IssueType) => void;
}

/** Changes a work item's task-level issue type from its Details field. */
export default function IssueTypePicker({
  projectId,
  value,
  saving,
  onChange,
}: IssueTypePickerProps) {
  const issueTypesQuery = useIssueTypesQuery(projectId);
  const issueTypes = (issueTypesQuery.data ?? EMPTY_ISSUE_TYPES).filter(
    (issueType) => issueType.level === "task",
  );
  const selected = issueTypeById(issueTypes, value);

  return (
    <Popover
      data-testid="issue-type-picker"
      align="right"
      disabled={saving}
      trigger={({ onClick, disabled }) => (
        <PickerTrigger
          onClick={onClick}
          disabled={disabled}
          saving={saving}
          variant="bare"
          label={selected ? <IssueTypeLabel issueType={selected} /> : "Unknown type"}
        />
      )}
    >
      {(close) => (
        <PopoverContent>
          {issueTypes.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted">
              No task issue types.
            </div>
          ) : (
            issueTypes.map((issueType) => (
              <PopoverOption
                key={issueType.id}
                selected={issueType.id === value}
                onClick={() => {
                  if (issueType.id !== value) onChange(issueType);
                  close();
                }}
              >
                <IssueTypeLabel issueType={issueType} />
              </PopoverOption>
            ))
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
