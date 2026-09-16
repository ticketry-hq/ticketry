import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type APIRequestContext } from "@playwright/test";

import { UpdateWorkTrackerModulePresentationDocument } from "../../src/features/projects/generated/projects.documents";
import { TransitionWorkTrackerWorkItemDocument } from "../../src/features/work-items/generated/workItems.documents";
import {
  acknowledgeOnboarding,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkItems,
  getWorkflowCatalog,
  graphql,
  selectModuleForProfile,
  type ModuleRow,
  type WorkItemRow,
} from "../../e2e/support";
import {
  datasetSpec,
  expectedCounts,
  largeDescription,
  moduleName,
  navigationModuleNames,
  pickerSearchTerm,
  workItemName,
  type DatasetSpec,
} from "./dataset";

/**
 * Seeding the synthetic workspace.
 *
 * Everything here goes through the same generated public GraphQL operations
 * the application itself uses, outside every measured window, and every
 * identity a scenario later addresses comes back from the server rather than
 * being assumed from a sequence number. The seed then re-reads the workspace
 * and records what the app's own queries actually return, so a scenario that
 * silently sees a truncated page shows up in the report instead of being read
 * as a fast one.
 *
 * Nothing here touches a live Ticketry profile: the caller supplies a fresh
 * temporary database, and the module folder is a throwaway git repository.
 */
const execFileAsync = promisify(execFile);

export interface SeedResult {
  datasetVersion: number;
  size: string;
  spec: DatasetSpec;
  seedDurationMs: number;
  /** Bounded retries spent on SQLite writer contention while seeding. */
  writeRetries: number;
  moduleFolder: string;
  projectId: string;
  counts: {
    expected: ReturnType<typeof expectedCounts>;
    createdModules: number;
    createdWorkItems: number;
    observedModules: number;
    observedWorkItems: number;
    truncated: boolean;
  };
  navigationModules: { name: string; id: string }[];
  pickerSearchTerm: string;
  pickerSearchExpectedModule: string;
  hiddenModuleIds: string[];
  detailWorkItems: { name: string; id: string; hasLargeDescription: boolean }[];
  stateMix: { value: Record<string, number> | null; reason: string | null };
}

/**
 * SQLite serializes writers, so bounded seeding concurrency still meets the
 * occasional `database is locked`. Retrying with backoff keeps the seed fast
 * without pretending the contention did not happen: the retry count is
 * recorded and reported alongside the seed duration.
 */
let writeRetries = 0;

async function withWriteRetry<T>(operation: () => Promise<T>): Promise<T> {
  let delayMs = 50;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (attempt >= 6 || !/database is locked|SQLITE_BUSY|database table is locked/i.test(message)) {
        throw error;
      }
      writeRetries += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await work(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function createFixtureFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "ticketry-performance-fixture-"));
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Ticketry Performance",
    GIT_AUTHOR_EMAIL: "performance@ticketry.invalid",
    GIT_COMMITTER_NAME: "Ticketry Performance",
    GIT_COMMITTER_EMAIL: "performance@ticketry.invalid",
  };
  const git = (...arguments_: string[]) =>
    execFileAsync("git", ["-C", folder, ...arguments_], { env: environment });
  await git("init", "-b", "main");
  await writeFile(join(folder, "README.md"), "Ticketry frontend profiling fixture\n");
  await git("add", "README.md");
  await git("commit", "-m", "Profiling fixture");
  return folder;
}

/**
 * One legal step through the published workflow. A work item may only be born
 * in its start state, so a deterministic state mix has to be walked rather
 * than requested at creation.
 */
function transitionWalk(
  catalog: Awaited<ReturnType<typeof getWorkflowCatalog>>,
  issueTypeId: string,
): { startStateId: string | null; nextState: Map<string, string> } {
  const issueType = catalog.issue_types.nodes.find((row) => row.id === issueTypeId);
  const nextState = new Map<string, string>();
  const transitions = [...(issueType?.transitions.nodes ?? [])].sort((left, right) =>
    (left.toState?.sort_order ?? 0) - (right.toState?.sort_order ?? 0)
  );
  for (const transition of transitions) {
    if (!transition.from_state || !transition.to_state) continue;
    if (transition.from_state === transition.to_state) continue;
    if (!nextState.has(transition.from_state)) {
      nextState.set(transition.from_state, transition.to_state);
    }
  }
  return { startStateId: issueType?.start_state ?? null, nextState };
}

export async function seedPerformanceWorkspace(
  request: APIRequestContext,
  size: string,
): Promise<SeedResult> {
  const spec = datasetSpec(size);
  const startedAt = Date.now();
  const moduleFolder = await createFixtureFolder();
  await acknowledgeOnboarding(request);

  const projects = await getProjects(request);
  const project = projects.find((row) => row.slug === "CDN")
    ?? await createProject(request, { name: "Coding", slug: "CDN", description: "" });

  const catalog = await getWorkflowCatalog(request, project.id);
  const moduleType = catalog.issue_types.nodes.find((row) =>
    row.level === "module" || row.name === "Module"
  );
  const storyType = catalog.issue_types.nodes.find((row) => row.name === "Story");
  expect(moduleType, "the provisioned Module issue type").toBeTruthy();
  expect(storyType, "the provisioned Story issue type").toBeTruthy();

  const existingModules = await getModules(request, project.id);
  const modules = await mapWithConcurrency(
    Array.from({ length: spec.moduleCount }, (_, index) => index),
    spec.seedConcurrency,
    async (index): Promise<ModuleRow> => {
      const name = moduleName(index);
      const existing = existingModules.find((row) => row.name === name);
      if (existing) return existing;
      return await withWriteRetry(() =>
        createModule(request, project.id, {
          name,
          issue_type_id: moduleType!.id,
        }));
    },
  );

  // Every module points at the same throwaway repository, so no module in the
  // dataset is accidentally cheaper to open than its neighbours.
  await mapWithConcurrency(modules, spec.seedConcurrency, async (module) => {
    await withWriteRetry(() =>
      selectModuleForProfile(request, project.id, module.id, moduleFolder));
  });

  const existingItems = await getWorkItems(request, project.id);
  const byName = new Map(existingItems.map((row) => [row.name, row]));
  const plan = modules.flatMap((module, moduleIndex) =>
    Array.from({ length: spec.workItemsPerModule }, (_, itemIndex) => ({
      module,
      moduleIndex,
      itemIndex,
      name: workItemName(moduleIndex, itemIndex),
    }))
  );
  // Parents first: a child needs its parent's identity, so the adoption rows
  // in each group are created after the group's root exists.
  const created = new Map<string, WorkItemRow>();
  const createOne = async (
    entry: (typeof plan)[number],
    parentId: string,
  ): Promise<WorkItemRow> => {
    const existing = byName.get(entry.name);
    if (existing) return existing;
    const useLargeDescription =
      (entry.itemIndex + 1) % spec.largeDescriptionEveryNth === 0;
    return await withWriteRetry(() =>
      createWorkItem(request, project.id, {
        name: entry.name,
        issue_type_id: storyType!.id,
        parent_id: parentId,
        description: useLargeDescription
          ? largeDescription(spec.largeDescriptionBytes, entry.name)
          : undefined,
      }));
  };

  const childGroupItemIndexes = new Set<number>();
  for (let group = 0; group < spec.childGroupsPerModule; group += 1) {
    childGroupItemIndexes.add(group * 3 + 1);
    childGroupItemIndexes.add(group * 3 + 2);
  }
  const parentOfGroup = (itemIndex: number) => Math.floor(itemIndex / 3) * 3;

  const topLevel = plan.filter((entry) => !childGroupItemIndexes.has(entry.itemIndex));
  await mapWithConcurrency(topLevel, spec.seedConcurrency, async (entry) => {
    created.set(entry.name, await createOne(entry, entry.module.id));
  });
  const children = plan.filter((entry) => childGroupItemIndexes.has(entry.itemIndex));
  await mapWithConcurrency(children, spec.seedConcurrency, async (entry) => {
    const parentName = workItemName(entry.moduleIndex, parentOfGroup(entry.itemIndex));
    const parent = created.get(parentName) ?? byName.get(parentName);
    created.set(
      entry.name,
      await createOne(entry, parent ? parent.id : entry.module.id),
    );
  });

  const walk = await walkStates(request, catalog, storyType!.id, plan, created, spec);

  // Leave exactly `visibleModuleTabs` tabs on screen; every other module stays
  // hidden, which is also what gives the module picker rows to filter.
  const hidden = modules.slice(spec.visibleModuleTabs);
  await mapWithConcurrency(modules, spec.seedConcurrency, async (module, index) => {
    await withWriteRetry(() =>
      graphql(request, UpdateWorkTrackerModulePresentationDocument, {
        moduleId: module.id,
        tabHidden: index >= spec.visibleModuleTabs,
      }));
  });

  const observedModules = await getModules(request, project.id);
  const observedWorkItems = await getWorkItems(request, project.id);
  const expected = expectedCounts(spec);
  const seededModules = observedModules.filter((row) => row.name.startsWith("Perf Module "));
  const seededItems = observedWorkItems.filter((row) => row.name.startsWith("Perf "));

  const stateMix = walk.reason === null
    ? { value: countStates(seededItems), reason: null }
    : { value: null, reason: walk.reason };

  const [firstModule, secondModule] = navigationModuleNames(spec);
  // Only top-level rows. The adopted rows in each parent/child group are
  // collapsed under their parent, so a scenario that clicked them by name
  // would be measuring a wait that never resolves rather than a detail view.
  const detailWorkItems = Array.from(
    { length: spec.workItemsPerModule },
    (_, index) => index,
  )
    .filter((index) => !childGroupItemIndexes.has(index))
    .slice(0, 20)
    .map((index) => {
      const name = workItemName(0, index);
      const row = created.get(name) ?? seededItems.find((item) => item.name === name);
      return {
        name,
        id: row?.id ?? "",
        hasLargeDescription: (index + 1) % spec.largeDescriptionEveryNth === 0,
      };
    })
    .filter((entry) => entry.id !== "");

  return {
    datasetVersion: spec.version,
    size: spec.size,
    spec,
    seedDurationMs: Date.now() - startedAt,
    writeRetries,
    moduleFolder,
    projectId: project.id,
    counts: {
      expected,
      createdModules: modules.length,
      createdWorkItems: created.size,
      observedModules: seededModules.length,
      observedWorkItems: seededItems.length,
      // Pagination is never disabled to make a dataset look bigger. If the
      // app's own query returns fewer rows than were created, the run says so.
      truncated: seededItems.length < expected.workItems
        || seededModules.length < expected.modules,
    },
    navigationModules: [firstModule, secondModule].map((name) => ({
      name,
      id: seededModules.find((row) => row.name === name)?.id ?? "",
    })),
    pickerSearchTerm: pickerSearchTerm(spec),
    pickerSearchExpectedModule: moduleName(spec.moduleCount - 1),
    hiddenModuleIds: hidden.map((module) => module.id),
    detailWorkItems,
    stateMix,
  };
}

async function walkStates(
  request: APIRequestContext,
  catalog: Awaited<ReturnType<typeof getWorkflowCatalog>>,
  issueTypeId: string,
  plan: { name: string; itemIndex: number }[],
  created: Map<string, WorkItemRow>,
  spec: DatasetSpec,
): Promise<{ moved: number; reason: string | null }> {
  const { startStateId, nextState } = transitionWalk(catalog, issueTypeId);
  if (!startStateId || nextState.size === 0) {
    return {
      moved: 0,
      reason: "the provisioned Story workflow publishes no forward transition, "
        + "so every seeded item stays in its birth state",
    };
  }
  const movers = plan.filter((entry) => (entry.itemIndex + 1) % spec.transitionEveryNth === 0);
  await mapWithConcurrency(movers, spec.seedConcurrency, async (entry) => {
    const row = created.get(entry.name);
    if (!row) return;
    const steps = (entry.itemIndex + 1) % (spec.transitionEveryNth * 2) === 0 ? 2 : 1;
    let stateId = row.state_id ?? startStateId;
    for (let step = 0; step < steps; step += 1) {
      const target = nextState.get(stateId);
      if (!target) break;
      const moved = await withWriteRetry(() =>
        graphql(request, TransitionWorkTrackerWorkItemDocument, {
          id: row.id,
          targetStateId: target,
        }));
      stateId = moved.update_work_item.state_id ?? target;
    }
  });
  return { moved: movers.length, reason: null };
}

/** The realised state distribution, read back from the server after the walk. */
function countStates(rows: WorkItemRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.state_id ?? "unset";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
