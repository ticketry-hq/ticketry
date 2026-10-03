import { createApolloStore } from "../../shared/apollo/localState";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";

const usePlanWrites = createApolloStore<{ pending: Record<string, true> }>("plan-write-guard", () => ({ pending: {} }));
export function claimPlanWrite(id: string): boolean {
  const key = compactWorktrackerId(id);
  const { pending } = usePlanWrites.getState();
  if (pending[key]) return false;
  usePlanWrites.setState({ pending: { ...pending, [key]: true } });
  return true;
}
export function releasePlanWrite(id: string): void {
  const { [compactWorktrackerId(id)]: removed, ...pending } = usePlanWrites.getState().pending;
  if (removed) usePlanWrites.setState({ pending });
}
export function usePlanWritePending(): (id: string) => boolean {
  usePlanWrites.getState();
  const pending = usePlanWrites((state) => state.pending);
  return (id) => Boolean(pending[compactWorktrackerId(id)]);
}
