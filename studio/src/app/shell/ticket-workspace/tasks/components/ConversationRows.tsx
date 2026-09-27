import { type InstantRunRow, type ScratchRow } from "../TasksPane";
import {
  isLiveAgentRunState,
  useAgentStatusSelection,
  useRunState,
} from "../../../../../features/agents/status";
import {
  LifecycleBadge,
  providerToneClasses,
} from "../../../../../features/agents/terminal";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import { openConversationComposer } from "../../../../../features/conversations";
import { globalShortcutLabel as shortcutLabel } from "../../../../navigation/useGlobalShortcutLabel";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";
import { instantRunPlanningRowId } from "../internal/instantRunTicketNavigation";
import { PlanningRowView } from "./PlanningRowView";
import { ClaudeStartupAttentionAction } from "../../../../../features/agents/lifecycle";

// The backend's name for a conversation whose title has not been generated.
const FALLBACK_TITLE = "Untitled instant chat";

interface ConversationRowProps {
  isSelected: boolean;
  onClick: (taskId: string) => void;
  dragSourceProps?: DragSourceProps;
}

function startedAtLabel(startedAt: string): { short: string; full: string } | null {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return null;
  return {
    short: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    full: date.toLocaleString(),
  };
}

/** One live Instant conversation: provider, title, status in words, start time. */
export function InstantRunPlanningRow({
  row,
  isSelected,
  onClick,
  dragSourceProps,
}: ConversationRowProps & { row: InstantRunRow }) {
  const id = instantRunPlanningRowId(row.runId);
  const runState = useRunState(row.runId);
  const agent = useAgentStatusSelection(
    (holding) => holding.runs[row.runId]?.agent ?? null,
  );
  const live = isLiveAgentRunState(runState);
  const untitled = row.name === FALLBACK_TITLE;
  const started = startedAtLabel(row.startedAt);
  return (
    <PlanningRowView
      id={id}
      depth={0}
      expandable={false}
      expanded={false}
      identifier=""
      stateColor={null}
      name={row.name}
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={() => undefined}
      dragSourceProps={dragSourceProps}
      descendantIds={[]}
      showAgentBadges={false}
      label={
        <span
          data-task-label
          title={agent ? `${row.name} · ${agent}` : row.name}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <span
            aria-hidden="true"
            data-conversation-provider={agent ?? undefined}
            className={`h-2 w-2 shrink-0 border ${providerToneClasses({
              agent,
              live,
              selected: true,
            })}`}
          />
          <span
            data-task-name
            className={`truncate ${untitled ? "italic text-text-secondary" : ""}`}
          >
            {row.name}
          </span>
        </span>
      }
      trailing={
        <>
          <ClaudeStartupAttentionAction runId={row.runId} />
          {live && runState ? (
            <span className="ml-2">
              <LifecycleBadge state={runState} />
            </span>
          ) : null}
          {started ? (
            <time
              dateTime={row.startedAt}
              title={`Started ${started.full}`}
              className="ml-2 shrink-0 text-xs text-text-muted"
            >
              {started.short}
            </time>
          ) : null}
        </>
      }
    />
  );
}

/** The action row: click (or ⌘I) starts now; its button (or ⌘⇧I) asks first. */
export function ScratchPlanningRow({
  isSelected,
  onClick,
  dragSourceProps,
}: ConversationRowProps & { row: ScratchRow }) {
  const startChord = shortcutLabel("instant-change");
  const promptChord = shortcutLabel("instant-change-with-prompt");
  return (
    <PlanningRowView
      id={TEMP_TASK_ID}
      depth={0}
      expandable={false}
      expanded={false}
      identifier=""
      stateColor={null}
      name="New conversation"
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={() => undefined}
      dragSourceProps={dragSourceProps}
      descendantIds={[]}
      showAgentBadges={false}
      label={
        <span
          data-task-label
          title="Start a conversation with the default agent"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-focus-accent"
        >
          <span aria-hidden="true" className="w-2 shrink-0 text-center">+</span>
          <span data-task-name className="truncate">New conversation</span>
          {startChord ? (
            <kbd className="shrink-0 font-mono text-xs text-text-muted">
              {startChord}
            </kbd>
          ) : null}
        </span>
      }
      trailing={
        <button
          type="button"
          tabIndex={-1}
          aria-label="Start a conversation with a prompt"
          title="Write the first message and choose the agent"
          onClick={(event) => {
            event.stopPropagation();
            openConversationComposer();
          }}
          className="ml-2 shrink-0 border border-pane-border px-1.5 text-xs text-text-secondary hover:border-focus-accent hover:text-focus-accent"
        >
          With prompt{promptChord ? ` ${promptChord}` : ""}
        </button>
      }
    />
  );
}
