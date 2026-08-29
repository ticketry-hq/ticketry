/**
 * The two writes the Module Link contract publishes.
 *
 * Each binds its Module and carries the local path alone; the cache shows the
 * new folder while the write is in flight and Apollo discards that layer when
 * the host refuses, so a refused write leaves the previously linked folder in
 * place.
 */

import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  ClearModuleLinkDocument,
  LoadModuleLinksDocument,
  SetModuleLinkDocument,
  type SetModuleLinkMutation,
} from "./generated/moduleLinks.documents";

// The cache needs the concrete object name; codegen elides `__typename` from
// the operation types, so the optimistic row is shaped here and named once.
function optimisticLink(
  moduleId: string,
  path: string,
  knownId: string | undefined,
): SetModuleLinkMutation["set_module_link"] {
  return {
    __typename: "ModuleLinks",
    id: knownId ?? `optimistic:${moduleId}`,
    moduleId,
    path,
  } as unknown as SetModuleLinkMutation["set_module_link"];
}

function cachedLinkId(moduleId: string): string | undefined {
  return studioApolloClient()
    .readQuery({ query: LoadModuleLinksDocument }, true)
    ?.moduleLinks.nodes.find(
      (link) => compactWorktrackerId(link.moduleId) === moduleId,
    )?.id;
}

/** Link a Module to a local folder. */
export async function writeModuleLink(
  moduleId: string,
  path: string,
): Promise<void> {
  const module = compactWorktrackerId(moduleId);
  await studioApolloClient().mutate({
    mutation: SetModuleLinkDocument,
    variables: { moduleId: module, path },
    optimisticResponse: {
      set_module_link: optimisticLink(module, path, cachedLinkId(module)),
    },
    update(cache, result) {
      const written = result.data?.set_module_link;
      if (!written) return;
      cache.updateQuery({ query: LoadModuleLinksDocument }, (current) => {
        if (!current) return current;
        const others = current.moduleLinks.nodes.filter(
          (link) =>
            compactWorktrackerId(link.moduleId) !==
            compactWorktrackerId(written.moduleId),
        );
        return {
          ...current,
          moduleLinks: { ...current.moduleLinks, nodes: [...others, written] },
        };
      });
    },
  });
}

/** Unlink a Module from its local folder. */
export async function eraseModuleLink(moduleId: string): Promise<void> {
  const module = compactWorktrackerId(moduleId);
  await studioApolloClient().mutate({
    mutation: ClearModuleLinkDocument,
    variables: { moduleId: module },
    optimisticResponse: { clear_module_link: true },
    update(cache) {
      cache.updateQuery({ query: LoadModuleLinksDocument }, (current) =>
        current
          ? {
              ...current,
              moduleLinks: {
                ...current.moduleLinks,
                nodes: current.moduleLinks.nodes.filter(
                  (link) => compactWorktrackerId(link.moduleId) !== module,
                ),
              },
            }
          : current,
      );
    },
  });
}
