import { useCallback } from "react";
import type { OperationVariables } from "@apollo/client";

import type { MutationDeclaration } from "./declaration";
import { executeDeclaredMutation } from "./executeDeclaredMutation";
import { useMutationState } from "./useMutationState";

/** React state for a declared mutation; pass a module-level declaration. */
export function useDeclaredMutation<
  TArgs,
  TData,
  TVariables extends OperationVariables,
  TRoot extends keyof TData & string,
  TResult = TData[TRoot],
>(declaration: MutationDeclaration<TArgs, TData, TVariables, TRoot, TResult>) {
  const execute = useCallback(
    (args: TArgs) => executeDeclaredMutation(declaration, args),
    [declaration],
  );
  return useMutationState(execute);
}
