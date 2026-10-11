/** Fractional base-62 rank uses binary string order, with sprint identity as a stable tie break. */
export function compareSprintSequence(left: { rank: string; id: string }, right: { rank: string; id: string }): number {
  const leftKey = left.rank === right.rank ? left.id : left.rank;
  const rightKey = left.rank === right.rank ? right.id : right.rank;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
