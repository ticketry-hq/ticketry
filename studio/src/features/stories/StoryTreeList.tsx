import type { ComponentType } from "react";
import {
  LOADING_PLACEHOLDER,
  STATE_HEADER,
  stateDropTargetId,
  type PlanningRow,
  type PlanningTreeRow,
} from "../work-items";
import type {
  AxisDragAndDropController,
  DragSourceProps,
  DropTargetProps,
} from "../../shared/dragDrop/useAxisDragAndDrop";
import type { StoryRootBlock } from "./storyRootBlocks";

export interface StoryTreeListProps {
  readonly blocks: readonly StoryRootBlock[];
  readonly planningRowId: (row: PlanningRow) => string;
  readonly selectedRowId: string | null;
  readonly collapsedStateIds: ReadonlySet<string>;
  readonly isSearchActive: boolean;
  readonly isReorderDisabled?: boolean;
  readonly pendingReorderId: string | null;
  readonly dragDrop: AxisDragAndDropController<{ taskId: string }, string>;
  readonly onSelect: (taskId: string) => void;
  readonly onToggleExpand: (taskId: string) => void;
  readonly onToggleStateCollapsed: (stateId: string) => void;
  readonly onToggleStateConfiguration: (stateId: string) => void;
  readonly onToggleConversationConfiguration: () => void;
  readonly TaskRow: ComponentType<{
    row: PlanningRow;
    isSelected: boolean;
    onClick: (taskId: string) => void;
    onToggleExpand: (taskId: string) => void;
    dragSourceProps?: DragSourceProps;
  }>;
  readonly StateHeaderRow: ComponentType<{
    stateName: string;
    stateColor: string;
    count: number;
    isCollapsed: boolean;
    onToggle: (stateId: string) => void;
    onConfigure: (stateId: string) => void;
    stateId?: string | null;
    dropTargetProps?: DropTargetProps;
    showDropSeam: boolean;
  }>;
  readonly ConversationsHeaderRow: ComponentType<{
    count: number;
    onConfigure: () => void;
  }>;
  readonly LoadingPlaceholderRow: ComponentType<{ depth: number }>;
}

/** Present tree rows without owning selection, expansion, or drag writes. */
export function StoryTreeList({
  blocks,
  planningRowId,
  selectedRowId,
  collapsedStateIds,
  isSearchActive,
  isReorderDisabled = isSearchActive,
  pendingReorderId,
  dragDrop,
  onSelect,
  onToggleExpand,
  onToggleStateCollapsed,
  onToggleStateConfiguration,
  onToggleConversationConfiguration,
  TaskRow,
  StateHeaderRow,
  ConversationsHeaderRow,
  LoadingPlaceholderRow,
}: StoryTreeListProps) {
  function renderNonTaskRow(row: Exclude<PlanningTreeRow, PlanningRow>) {
    if (
      "kind" in row &&
      row.kind === STATE_HEADER &&
      row.key === "header-conversations"
    ) {
      return (
        <ConversationsHeaderRow
          key={row.key}
          count={row.count}
          onConfigure={onToggleConversationConfiguration}
        />
      );
    }
    if ("kind" in row && row.kind === STATE_HEADER) {
      const targetId = row.stateId ? stateDropTargetId(row.stateId) : null;
      const isTarget =
        targetId !== null &&
        dragDrop.targetId === targetId &&
        dragDrop.payload !== null;
      return (
        <StateHeaderRow
          key={row.key}
          stateName={row.stateName}
          stateColor={row.stateColor}
          count={row.count}
          isCollapsed={
            isSearchActive || !row.stateId
              ? false
              : collapsedStateIds.has(row.stateId)
          }
          onToggle={onToggleStateCollapsed}
          onConfigure={onToggleStateConfiguration}
          stateId={row.stateId}
          dropTargetProps={
            targetId && !isReorderDisabled
              ? dragDrop.getDropTargetProps(targetId)
              : undefined
          }
          showDropSeam={isTarget}
        />
      );
    }
    if ("kind" in row && row.kind === LOADING_PLACEHOLDER) {
      return <LoadingPlaceholderRow key={row.key} depth={row.depth} />;
    }
    return null;
  }

  function renderBlock(block: StoryRootBlock) {
    if (block.kind === "row") return renderNonTaskRow(block.row);
    const root = block.rows[0];
    const rootId = planningRowId(root);
    // Hide descendants only for the live drag. Every controller termination
    // clears its payload and restores the persisted expansion unchanged.
    const renderedRows =
      dragDrop.payload?.taskId === rootId
        ? block.rows.slice(0, 1)
        : block.rows;
    const canDrag =
      root.kind === "work-item" &&
      root.parentId === null &&
      pendingReorderId !== root.id &&
      !isReorderDisabled;
    const canTarget = root.kind === "work-item" && !isReorderDisabled;
    const isTarget =
      canTarget &&
      dragDrop.targetId === rootId &&
      dragDrop.intent !== null &&
      dragDrop.payload?.taskId !== rootId;
    const targetProps = canTarget
      ? dragDrop.getDropTargetProps(rootId)
      : undefined;

    return (
      <li
        key={`block-${rootId}`}
        role="none"
        className="relative"
        {...targetProps}
      >
        {isTarget ? (
          <span
            data-ticket-drop-seam
            data-testid="ticket-drop-seam"
            aria-hidden="true"
            className={`pointer-events-none absolute right-0 left-0 z-10 h-0.5 bg-focus-accent ${
              dragDrop.intent === "near" ? "top-0" : "bottom-0"
            }`}
          />
        ) : null}
        <ul role="group">
          {renderedRows.map((row, index) => (
            <TaskRow
              key={planningRowId(row)}
              row={row}
              isSelected={planningRowId(row) === selectedRowId}
              onClick={onSelect}
              onToggleExpand={onToggleExpand}
              dragSourceProps={
                index === 0 && canDrag
                  ? dragDrop.getDragSourceProps({ taskId: rootId })
                  : undefined
              }
            />
          ))}
        </ul>
      </li>
    );
  }

  return (
    <ul role="tree" tabIndex={-1}>
      {blocks.map(renderBlock)}
    </ul>
  );
}
