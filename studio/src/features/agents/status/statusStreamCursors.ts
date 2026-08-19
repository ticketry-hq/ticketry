/**
 * One retained status cursor per project.
 *
 * The cursor only ever moves forward. A duplicate, backwards, or non-integer
 * cursor is ignored rather than rejected loudly, because the server is allowed
 * to redeliver a fact that a snapshot already reflected.
 */
export interface StatusCursorStore {
  get(projectId: string): number | undefined;
  /** Returns true when the cursor advanced and its frame should be applied. */
  advance(projectId: string, cursor: number): boolean;
  /** Install an authoritative baseline after a snapshot or reset. */
  install(projectId: string, cursor: number): void;
  forget(projectId: string): void;
}

const isCursor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function createStatusCursorStore(
  initial: Readonly<Record<string, number>> = {},
): StatusCursorStore {
  const retained = new Map<string, number>(
    Object.entries(initial).filter(([, cursor]) => isCursor(cursor)),
  );
  return {
    get: (projectId) => retained.get(projectId),
    advance(projectId, cursor) {
      if (!isCursor(cursor)) return false;
      const current = retained.get(projectId);
      if (current !== undefined && cursor <= current) return false;
      retained.set(projectId, cursor);
      return true;
    },
    install(projectId, cursor) {
      if (!isCursor(cursor)) return;
      const current = retained.get(projectId);
      retained.set(projectId, current === undefined ? cursor : Math.max(current, cursor));
    },
    forget(projectId) {
      retained.delete(projectId);
    },
  };
}
