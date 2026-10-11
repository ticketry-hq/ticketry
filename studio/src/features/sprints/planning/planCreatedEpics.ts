import { createApolloStore } from "../../../shared/apollo/localState";
import { getWorkItemSnapshot } from "../../work-items";
import type { PlanEpic } from "./epicMembership";

// Only successful identities awaiting graph convergence live here. Visits and
// server records remain in their existing Apollo rows.
export const usePlanCreatedEpics = createApolloStore<{ pending: Record<string, string[]> }>(
  "plan-created-epics",
  () => ({ pending: {} }),
);

export function createdEpicOwner(projectId: string, sprintId: string): string {
  return JSON.stringify([projectId, sprintId]);
}

export function pendingPlanEpics(owner: string): PlanEpic[] {
  return (usePlanCreatedEpics.getState().pending[owner] ?? []).map((id) => ({
    id, name: getWorkItemSnapshot(id)?.name ?? "Created epic",
  }));
}

export function rememberCreatedEpic(owner: string, epicId: string): void {
  const { pending } = usePlanCreatedEpics.getState();
  const current = pending[owner] ?? [];
  if (!current.includes(epicId)) {
    usePlanCreatedEpics.setState({ pending: { ...pending, [owner]: [...current, epicId] } });
  }
}

export function observeCreatedEpics(owner: string, epics: PlanEpic[]): void {
  const { pending } = usePlanCreatedEpics.getState();
  const current = pending[owner];
  if (!current) return;
  const retained = current.filter((id) => !epics.some((epic) => epic.id === id));
  if (retained.length === current.length) return;
  const next = { ...pending };
  if (retained.length) next[owner] = retained;
  else delete next[owner];
  usePlanCreatedEpics.setState({ pending: next });
}
