import type { DropIntent } from "../../../../../shared/dragDrop/useAxisDragAndDrop";

export interface VisibleRootBlock {
  readonly rootId: string;
  readonly rowIds: readonly string[];
}

export interface ReorderNeighbors {
  readonly beforeId: string | null;
  readonly afterId: string | null;
}

/**
 * Convert a visible, rank-descending root-block hover into the API's
 * rank-ascending neighbor pair. Descendant row ids deliberately resolve to
 * their owning root block, so no result can describe a seam within a subtree.
 */
export function resolveTicketReorderNeighbors(
  blocks: readonly VisibleRootBlock[],
  draggedRootId: string,
  hoveredRowId: string | null,
  intent: DropIntent,
): ReorderNeighbors | null {
  const draggedIndex = blocks.findIndex(
    (block) => block.rootId === draggedRootId,
  );
  const remaining = blocks.filter(
    (block) => block.rootId !== draggedRootId,
  );
  // A null row represents the state header. Headers always mean the visible
  // head of a section, including sections that are collapsed or empty.
  if (hoveredRowId === null) {
    if (draggedIndex === 0) return null;
    return {
      beforeId: remaining[0]?.rootId ?? null,
      afterId: null,
    };
  }

  const target = blocks.find((block) =>
    block.rowIds.includes(hoveredRowId),
  );
  if (!target || target.rootId === draggedRootId) return null;

  const targetIndex = remaining.findIndex(
    (block) => block.rootId === target.rootId,
  );
  if (targetIndex < 0) return null;

  const insertionIndex = targetIndex + (intent === "far" ? 1 : 0);
  // When the dragged root is absent it came from another state, so there is no
  // within-section no-op position to reject.
  if (draggedIndex >= 0 && insertionIndex === draggedIndex) return null;

  // Visible order is descending rank. Therefore the visible block below the
  // seam is the canonical "before" neighbor and the block above is "after".
  return {
    beforeId: remaining[insertionIndex]?.rootId ?? null,
    afterId: remaining[insertionIndex - 1]?.rootId ?? null,
  };
}
