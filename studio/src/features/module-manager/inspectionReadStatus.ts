import { createApolloStore } from "../../shared/apollo/localState";

export type InspectionAvailability = "loading" | "available" | "unavailable" | "unknown";
export interface InspectionReadStatus { loading: boolean; error: string | null; generation?: number }
export const emptyInspectionStatus: InspectionReadStatus = { loading: false, error: null };
export const useInspectionReadStatus = createApolloStore<{ reads: Record<string, InspectionReadStatus> }>(
  "module-manager-inspection-reads", () => ({ reads: {} }),
);
export function writeInspectionStatus(key: string, status: InspectionReadStatus) {
  useInspectionReadStatus.setState((state) => ({ reads: { ...state.reads, [key]: status } }));
}
