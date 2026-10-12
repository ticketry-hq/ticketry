import { publicWorktrackerId } from "../shared/api/generatedWorktracker";
import type { Module, Project, WorkItem } from "../shared/api/types";
import type { FoundationDomainErrorCode } from "../shared/apollo/errorLink";
import * as api from "./legacyApiFixture";
import { projectOpenFixture } from "./projectOpenFixture";
import {
  installScriptedGraphQlTransport,
  ScriptedGraphQlFailure,
  type ScriptedGraphQlTransport,
} from "./scriptedGraphQlTransport";

/**
 * The module reorder suites' GraphQL server, scripted through the legacy
 * fixture names they already speak.
 *
 * Studio sends real `WorkTrackerProjects` and `WorkTrackerProjectOpen` reads
 * and `ReorderWorkTrackerModulePresentation` writes through its Apollo client;
 * this adapter answers them from the suites' `listProjects`, `listModules` and
 * `reorderWorkItem` mocks with public ids, and turns a mock's rejection into a
 * GraphQL domain error carrying the same message.
 */

type Variables = Readonly<Record<string, unknown>>;

const listProjects = api.listProjects as () => Promise<Project[]>;
const listModules = api.listModules as (projectId: string) => Promise<Module[]>;
const reorderWorkItem = api.reorderWorkItem as (
  moduleId: string,
  neighbors: Record<string, unknown>,
) => Promise<WorkItem | undefined>;

async function asDomainError<T>(
  code: FoundationDomainErrorCode,
  pending: () => Promise<T>,
): Promise<T> {
  try {
    return await pending();
  } catch (error) {
    throw new ScriptedGraphQlFailure(
      code,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" ? publicWorktrackerId(value) : null;
}

async function projectList() {
  const projects = await asDomainError("worktracker_read_failed", () => listProjects());
  return {
    projects: {
      __typename: "WorktrackerProjectConnection",
      nodes: projects.map((project) => ({
        __typename: "WorktrackerProject",
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        created_at: "2026-01-01T00:00:00Z",
      })),
    },
  };
}

async function projectOpen(variables: Variables) {
  const projectId = publicWorktrackerId(String(variables.projectId));
  const [projects, modules] = await asDomainError("worktracker_read_failed", () =>
    Promise.all([listProjects(), listModules(projectId)]),
  );
  const project = projects.find((candidate) => candidate.id === projectId)
    ?? projects[0];
  if (!project) {
    throw new ScriptedGraphQlFailure("not_found", `Project ${projectId} was not found.`);
  }
  return projectOpenFixture(project, modules).data;
}

async function reorderModulePresentation(variables: Variables) {
  const moved = await asDomainError("validation", () =>
    reorderWorkItem(publicWorktrackerId(String(variables.moduleId)), {
      before_id: optionalId(variables.beforeId),
      after_id: optionalId(variables.afterId),
      initial_order_ids: Array.isArray(variables.initialOrderIds)
        ? variables.initialOrderIds.map((id) => publicWorktrackerId(String(id)))
        : undefined,
    }),
  );
  return {
    reorder_module_presentation: {
      __typename: "WorktrackerModulepresentation",
      module_id: variables.moduleId,
      rank: typeof moved?.rank === "string" ? moved.rank : "",
      tab_hidden: false,
    },
  };
}

export function installModuleReorderTransport(): ScriptedGraphQlTransport {
  return installScriptedGraphQlTransport()
    .answer("WorkTrackerProjects", projectList)
    .answer("WorkTrackerProjectOpen", projectOpen)
    .answer("ReorderWorkTrackerModulePresentation", reorderModulePresentation);
}
