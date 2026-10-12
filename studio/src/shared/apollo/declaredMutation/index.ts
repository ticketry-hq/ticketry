// Declared mutations: a generated document plus its cache effects, run by one
// shared executor. See docs/feature-map/frontend-mutations.md.
export type {
  CacheIdentity,
  MutationDeclaration,
  MutationDiagnostics,
  MutationPhase,
  RefreshRead,
} from "./declaration";
export { declareMutation, refreshRead } from "./declaration";
export { executeDeclaredMutation } from "./executeDeclaredMutation";
export { mutationFailurePhase } from "./mutationFailure";
export { useDeclaredMutation } from "./useDeclaredMutation";
export type {
  MutationCallbacks,
  MutationStateOptions,
  OptimisticConstruction,
} from "./useMutationState";
export { useMutationState } from "./useMutationState";
