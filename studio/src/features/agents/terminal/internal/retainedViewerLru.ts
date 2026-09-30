/** Returns retained run IDs from least to most recently viewed. */
export function retainMostRecentRunIds({
  currentRunIds,
  openedRunIds,
  liveRunIds,
  retentionLimit,
}: {
  currentRunIds: string[];
  openedRunIds: string[];
  liveRunIds: ReadonlySet<string>;
  retentionLimit: number;
}): string[] {
  const opened = [...new Set(openedRunIds)].filter((runId) =>
    liveRunIds.has(runId),
  );
  const openedSet = new Set(opened);
  const refreshed = [
    ...currentRunIds.filter(
      (runId) => liveRunIds.has(runId) && !openedSet.has(runId),
    ),
    ...opened,
  ];
  if (!Number.isFinite(retentionLimit)) return refreshed;

  // The active run is always the most recent entry and must remain mounted,
  // even when a caller supplies zero while changing retention settings.
  const minimum = opened.length > 0 ? 1 : 0;
  const limit = Math.max(minimum, Math.floor(retentionLimit));
  return limit === 0 ? [] : refreshed.slice(-limit);
}
