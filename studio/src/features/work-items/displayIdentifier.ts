export function formatWorkItemDisplayIdentifier(
  sequenceId: number | null | undefined,
): string {
  return sequenceId == null ? "" : `T-${sequenceId}`;
}
