import type { BacklogState } from "./backlogStore";

export function mirrorBlockerChange(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  blockedId: string,
  addedBlockerIds: string[],
  removedBlockerIds: string[],
): void {
  const added = new Set(addedBlockerIds);
  const removed = new Set(removedBlockerIds);
  if (!added.size && !removed.size) return;
  set({
    items: get().items.map((i) => {
      if (added.has(i.id) && !i.blocks_ids.includes(blockedId)) {
        return { ...i, blocks_ids: [...i.blocks_ids, blockedId] };
      }
      if (removed.has(i.id) && i.blocks_ids.includes(blockedId)) {
        return { ...i, blocks_ids: i.blocks_ids.filter((x) => x !== blockedId) };
      }
      return i;
    }),
  });
}
