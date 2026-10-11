export type CreateSprintOutcome =
  | { kind: "created"; id: string }
  | { kind: "refreshFailed"; id: string; message: string; refresh: () => Promise<void> }
  | { kind: "missing" };
