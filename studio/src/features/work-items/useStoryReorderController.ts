import { useCallback } from "react";
import type { State, WorkItem } from "../../shared/api/types";
import { useAxisDragAndDrop } from "../../shared/dragDrop/useAxisDragAndDrop";
import { useReorderWorkItem, useSetWorkItemState } from "./mutations";
import { recordStoryMove } from "./internal/storyMoveDiagnostics";
import {
  ticketDragCodec,
  type TicketDragPayload,
} from "./internal/ticketDragCodec";
import {
  resolveTicketReorderNeighbors,
  type VisibleRootBlock,
} from "./internal/ticketReorder";

export { stateDropTargetId, type TicketDragPayload } from "./internal/ticketDragCodec";

export interface StoryReorderControllerOptions {
  readonly projectId: string | null;
  readonly moduleId: string | null;
  readonly itemsById: Readonly<Record<string, WorkItem>>;
  readonly states: readonly State[];
  readonly sectionIdsByState: Readonly<Record<string, readonly string[]>>;
  readonly visibleBlocks: readonly VisibleRootBlock[];
  readonly disabled: boolean;
}

/** Adapt canonical Story sections to the existing transition and rank writes. */
export function useStoryReorderController({
  projectId: selectedProjectId,
  moduleId: selectedModuleId,
  itemsById,
  states,
  sectionIdsByState,
  visibleBlocks,
  disabled,
}: StoryReorderControllerOptions) {
  const reorder = useReorderWorkItem({
    projectId: selectedProjectId ?? "",
    moduleId: selectedModuleId ?? "",
  });
  const setState = useSetWorkItemState();

  const handleDrop = useCallback(
    (
      payload: TicketDragPayload,
      resolved: { targetId: string; intent: "near" | "far" },
    ) => {
      const source = itemsById[payload.taskId];
      if (!source || !selectedProjectId || !selectedModuleId) {
        recordStoryMove("drop-rejected", {
          storyId: payload.taskId,
          reason: !source
            ? "source-not-cached"
            : !selectedProjectId
              ? "project-not-selected"
              : "module-not-selected",
          selectedProjectId,
          selectedModuleId,
        }, "warn");
        return;
      }
      const headerStateId = resolved.targetId.startsWith("state:")
        ? resolved.targetId.slice("state:".length)
        : null;
      const target = headerStateId
        ? null
        : itemsById[resolved.targetId];
      const destinationState = states.find(
        (state) => state.id === (headerStateId ?? target?.state),
      );
      if (!destinationState?.id) {
        recordStoryMove("drop-rejected", {
          storyId: payload.taskId,
          reason: "destination-state-not-found",
          sourceStateId: source.state,
          targetId: resolved.targetId,
          headerStateId,
          targetStateId: target?.state ?? null,
        }, "warn");
        return;
      }

      const sectionBlocks = visibleBlocks.filter((block) =>
        itemsById[block.rootId]?.state === destinationState.id,
      );
      // Collapsed headers have no visible blocks. Rebuild their root-only
      // section from the ranked task list so a head drop still uses the real
      // first destination neighbor.
      const destinationBlocks =
        sectionBlocks.length > 0 || !headerStateId
          ? sectionBlocks
          : (sectionIdsByState[destinationState.id] ?? [])
              .map((id) => ({ rootId: id, rowIds: [id] }));
      const neighbors = resolveTicketReorderNeighbors(
        destinationBlocks,
        payload.taskId,
        headerStateId ? null : resolved.targetId,
        resolved.intent,
      );
      if (!neighbors) {
        recordStoryMove("drop-rejected", {
          storyId: payload.taskId,
          reason: "reorder-neighbors-not-resolved",
          sourceStateId: source.state,
          destinationStateId: destinationState.id,
          targetId: resolved.targetId,
          intent: resolved.intent,
          destinationRootIds: destinationBlocks.map((block) => block.rootId),
        }, "warn");
        return;
      }
      recordStoryMove("drop-resolved", {
        storyId: payload.taskId,
        sourceStateId: source.state,
        destinationStateId: destinationState.id,
        targetId: resolved.targetId,
        intent: resolved.intent,
        beforeId: neighbors.beforeId,
        afterId: neighbors.afterId,
        requiresTransition: source.state !== destinationState.id,
      });
      if (source.state === destinationState.id) {
        reorder.mutate({
          id: payload.taskId,
          beforeId: neighbors.beforeId,
          afterId: neighbors.afterId,
        });
      } else {
        setState.mutate(
          { id: payload.taskId, state: destinationState as typeof destinationState & { id: string } },
          {
            onSuccess: () => reorder.mutate({
              id: payload.taskId,
              beforeId: neighbors.beforeId,
              afterId: neighbors.afterId,
            }),
          },
        );
      }
    },
    [
      reorder,
      setState,
      itemsById,
      selectedModuleId,
      selectedProjectId,
      states,
      sectionIdsByState,
      visibleBlocks,
    ],
  );
  const dragDrop = useAxisDragAndDrop<TicketDragPayload, string>({
    axis: "vertical",
    codec: ticketDragCodec,
    disabled:
      disabled || !selectedProjectId || !selectedModuleId,
    onDrop: handleDrop,
  });

  return { dragDrop, reorder };
}
