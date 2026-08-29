/**
 * Where each Module's code lives on this machine, read and written through the
 * generated ModuleLink graph.
 *
 * Apollo's cache is the only place a link is held. Nothing mirrors it into a
 * second application-state store or into the profile snapshot: a folder is the
 * Module's own fact, so a component that needs one subscribes to the same cache
 * rows the Rust host authored.
 */

import { useQuery } from "@apollo/client/react";

import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { isAbsoluteFolderPath } from "../studio/lib/moduleFolderPath";
import {
  LoadModuleLinksDocument,
  type LoadModuleLinksQuery,
  type ModuleLinkFieldsFragment,
} from "./generated/moduleLinks.documents";
import { eraseModuleLink, writeModuleLink } from "./moduleLinkTransport";

export type ModuleLink = ModuleLinkFieldsFragment;

const NO_LINKS: ModuleLink[] = [];

function linksOf(data: LoadModuleLinksQuery | null | undefined): ModuleLink[] {
  return data ? data.moduleLinks.nodes : NO_LINKS;
}

/**
 * The cached links, or none before the first read resolves.
 *
 * The optimistic layer is included so an imperative caller and a subscribed
 * component never disagree about a folder while a write is in flight.
 */
export function getModuleLinks(): ModuleLink[] {
  return linksOf(
    studioApolloClient().readQuery({ query: LoadModuleLinksDocument }, true),
  );
}

/** Explicit reload (bootstrap, external change): always hits the host. */
export async function loadModuleLinks(): Promise<ModuleLink[]> {
  const { data } = await studioApolloClient().query({
    query: LoadModuleLinksDocument,
    fetchPolicy: "network-only",
  });
  return linksOf(data);
}

/** Subscribe to the links; renders none until the first read resolves. */
export function useModuleLinks(): ModuleLink[] {
  const { data } = useQuery(LoadModuleLinksDocument, {
    client: studioApolloClient(),
  });
  return linksOf(data);
}

function folderIn(links: ModuleLink[], moduleId: string): string | undefined {
  const wanted = compactWorktrackerId(moduleId);
  return links.find((link) => compactWorktrackerId(link.moduleId) === wanted)
    ?.path;
}

/** The folder linked to a Module, read from the cache without subscribing. */
export function getModuleFolder(moduleId: string): string | undefined {
  return folderIn(getModuleLinks(), moduleId);
}

/** The folder linked to a Module, re-rendering when the link changes. */
export function useModuleFolder(
  moduleId: string | null | undefined,
): string | undefined {
  const links = useModuleLinks();
  return moduleId ? folderIn(links, moduleId) : undefined;
}

/**
 * Folders this installation has already linked, most recently written first.
 *
 * The link list is ordered by when each was last written, so reversing it
 * offers the folders a person is most likely to reach for again.
 */
export function recentModuleFolders(links: ModuleLink[]): string[] {
  return Array.from(
    new Set(
      links
        .map((link) => link.path)
        .reverse()
        .filter(isAbsoluteFolderPath),
    ),
  );
}

/**
 * Link a Module to a local folder.
 *
 * A path that is not a complete filesystem path is refused here, before the
 * host is asked; the host still validates that the folder is usable.
 */
export async function setModuleFolder(
  moduleId: string,
  path: string,
): Promise<void> {
  if (!isAbsoluteFolderPath(path)) {
    throw new Error("Module folders require a complete filesystem path.");
  }
  await writeModuleLink(moduleId, path);
}

/** Unlink a Module from its local folder. */
export async function clearModuleFolder(moduleId: string): Promise<void> {
  await eraseModuleLink(moduleId);
}

/** Test seam: seed the cached links without a host round-trip. */
export function seedModuleLinks(links: ModuleLink[]): void {
  studioApolloClient().writeQuery({
    query: LoadModuleLinksDocument,
    data: {
      moduleLinks: {
        __typename: "ModuleLinksConnection",
        nodes: links.map((link) => ({
          __typename: "ModuleLinks",
          id: link.id,
          moduleId: compactWorktrackerId(link.moduleId),
          path: link.path,
        })),
      },
    } as unknown as LoadModuleLinksQuery,
  });
}
