import { useMutation } from "@tanstack/react-query";

import * as api from "../../shared/api/client";
import { apiErrorMessage } from "../../shared/api/client";
import type { ModulePresentation } from "../../shared/api/types";
import { queryKeys } from "../../shared/query/keys";
import { queryClient } from "../../shared/query/queryClient";
import { toast } from "../../state/clientStore";

interface VisibilityVariables {
  moduleId: string;
  tabHidden: boolean;
}

interface VisibilityContext {
  previous: ModulePresentation[] | undefined;
}

function replacePresentation(
  current: readonly ModulePresentation[] | undefined,
  next: ModulePresentation,
): ModulePresentation[] {
  const presentations = current ?? [];
  const index = presentations.findIndex(
    (presentation) => presentation.module_id === next.module_id,
  );
  if (index === -1) return [...presentations, next];
  return presentations.map((presentation, position) =>
    position === index ? next : presentation,
  );
}

export function useSetModuleTabHidden() {
  return useMutation<
    ModulePresentation,
    Error,
    VisibilityVariables,
    VisibilityContext
  >(
    {
      mutationFn: ({ moduleId, tabHidden }) =>
        api.updateModulePresentation(moduleId, { tab_hidden: tabHidden }),

      async onMutate({ moduleId, tabHidden }) {
        const key = queryKeys.modulePresentations.all;
        await queryClient.cancelQueries({ queryKey: key, exact: true });
        const previous = queryClient.getQueryData<ModulePresentation[]>(key);
        const current = previous?.find(
          (presentation) => presentation.module_id === moduleId,
        );
        queryClient.setQueryData<ModulePresentation[]>(
          key,
          replacePresentation(previous, {
            module_id: moduleId,
            rank: current?.rank ?? "",
            tab_hidden: tabHidden,
          }),
        );
        return { previous };
      },

      onError(error, variables, context) {
        queryClient.setQueryData(
          queryKeys.modulePresentations.all,
          context?.previous,
        );
        toast.error(
          `Module tab could not be ${variables.tabHidden ? "hidden" : "restored"}: ${apiErrorMessage(error)}`,
        );
      },

      onSuccess(presentation) {
        queryClient.setQueryData<ModulePresentation[]>(
          queryKeys.modulePresentations.all,
          (current) => replacePresentation(current, presentation),
        );
      },

      async onSettled() {
        await queryClient.refetchQueries({
          queryKey: queryKeys.modulePresentations.all,
          exact: true,
        });
      },
    },
    queryClient,
  );
}
