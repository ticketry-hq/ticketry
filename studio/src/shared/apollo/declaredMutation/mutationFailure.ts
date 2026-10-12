import { graphQlMutationError } from "../../api/graphqlError";
import type { MutationPhase } from "./declaration";

const failurePhases = new WeakMap<object, MutationPhase>();

/**
 * Map a failure into the UI error contract once and tag the phase it came from.
 *
 * Domain GraphQL failures become the established REST-shaped `ApiError`;
 * anything else passes through unchanged.
 */
export function mutationFailure(phase: MutationPhase, error: unknown): unknown {
  let mapped = error;
  try {
    graphQlMutationError(error);
  } catch (failure) {
    mapped = failure;
  }
  if (typeof mapped === "object" && mapped !== null) failurePhases.set(mapped, phase);
  return mapped;
}

/**
 * Which phase a declared-mutation rejection came from. `"refresh"` means the
 * write committed and only a post-write read failed; `null` means the error
 * did not come from a declared mutation.
 */
export function mutationFailurePhase(error: unknown): MutationPhase | null {
  return typeof error === "object" && error !== null
    ? failurePhases.get(error) ?? null
    : null;
}
