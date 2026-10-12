import { editionHas } from "../../shared/config/edition";

export type GraphRunExecutionMode = "parallel" | "serial";

/**
 * The execution mode one Graph Run create/update request carries. An edition
 * without parallel subtree runs sends serial on every request, so no caller
 * can ask for (or default into) a parallel campaign. Otherwise the caller's
 * mode passes through and an omitted mode stays unset, leaving the server's
 * historical parallel default in place.
 */
export function graphRunRequestMode(
  requested: GraphRunExecutionMode | undefined,
  parallelAvailable: boolean = editionHas("parallelSubtreeRuns"),
): GraphRunExecutionMode | null {
  return parallelAvailable ? requested ?? null : "serial";
}
