/**
 * The single left-aligned label of a Stories-pane row: the compact display
 * identifier, a middle dot, then the work-item name. Identifier and name read
 * as one unit and truncate together, so trailing operational indicators keep
 * their own space. Only the identifier token carries workflow-state color.
 *
 * Rows whose compact identifier cannot be resolved render the name alone —
 * no separator, no fallback token, and never a canonical tracker key.
 */
interface WorkItemRowLabelProps {
  identifier: string;
  stateColor: string | null;
  name: string;
}

export function WorkItemRowLabel({
  identifier,
  stateColor,
  name,
}: WorkItemRowLabelProps) {
  return (
    <span data-task-label className="min-w-0 flex-1 truncate">
      {identifier ? (
        <>
          <span
            data-task-id-token
            className={stateColor ? undefined : "text-text-muted"}
            style={stateColor ? { color: stateColor } : undefined}
          >
            {identifier}
          </span>
          <span className="text-text-muted"> · </span>
        </>
      ) : null}
      <span data-task-name>{name}</span>
    </span>
  );
}
