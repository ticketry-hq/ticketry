import { ModalHost } from "../app/modal";
import { WorkTrackerWorkItemDocument } from "../features/work-items";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import type { IssueType, State } from "../shared/api/types";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { workItem } from "./seam";

const MODULE_TYPE: IssueType = { id: "module-type", name: "Module", level: "module", color: null, sort_order: 0 };

const REVIEWED_STATES: State[] = ([
  ["Ideas", "backlog"], ["Grill", "backlog"], ["Spec", "unstarted"], ["Tickets", "unstarted"],
  ["Implement", "started"], ["Review", "started"], ["Done", "completed"], ["Cancelled", "cancelled"],
] as const).map(([name, group], index) => ({ id: `state-${name.toLowerCase()}`, name, group, color: null, sort_order: index }));

const REVIEWED_TASK_TYPES: IssueType[] = ([
  ["Story", "state-ideas"], ["PathFind", "state-spec"], ["Implementation", "state-implement"],
] as const).map(([name, start], index) => ({
  id: `type-${name.toLowerCase()}`, name, level: "task", color: null, sort_order: index + 1, start_state: start,
}));

/** What project creation seeds: core leaves only `Module` (CODING-2860); Pocock adds the reviewed workflow. */
export const NEW_PROJECT_CATALOGS = {
  empty: { states: [] as State[], issueTypes: [MODULE_TYPE] },
  reviewed: { states: REVIEWED_STATES, issueTypes: [MODULE_TYPE, ...REVIEWED_TASK_TYPES] },
};

const createdAt = "2026-10-12T00:00:00Z";
const stateRow = (state: State) => ({
  __typename: "WorktrackerState", id: state.id, project: "project-1", name: state.name, group: state.group,
  color: "", sort_order: state.sort_order ?? 0, is_protected: false, created_at: createdAt, updated_at: createdAt,
});
const issueTypeRow = (type: IssueType) => ({
  __typename: "WorktrackerIssuetype", id: type.id, project: "project-1", name: type.name, level: type.level,
  color: "", sort_order: type.sort_order ?? 0, start_state: type.start_state ?? null, workflow_revision: 1,
  is_pathfind: false, created_at: createdAt, updated_at: createdAt,
  transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [] },
  launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [] },
});

/** A freshly created project: modules, but no stories and no sprints yet. */
export function newProjectFixture(workflow: keyof typeof NEW_PROJECT_CATALOGS) {
  const catalog = NEW_PROJECT_CATALOGS[workflow];
  const f = editionAcceptanceFixture();
  f.http.storySprints([]);
  f.modules.forEach((module) => f.http.tree(module.id, { rootIds: [], children: {}, order: [] }));
  const states = { __typename: "WorktrackerStateConnection", nodes: catalog.states.map(stateRow) };
  const issueTypes = { __typename: "WorktrackerIssuetypeConnection", nodes: catalog.issueTypes.map(issueTypeRow) };
  const writes: Array<{ operation: string; variables: unknown }> = [];

  async function create(variables: { name: string; issueTypeId: string; parentId: string | null }) {
    const type = catalog.issueTypes.find(({ id }) => id === variables.issueTypeId)!;
    const id = type.level === "module" ? "created-module" : "created-story";
    if (type.level === "module") {
      f.modules.push({ id, name: variables.name, project_id: "project-1", sequence_id: 4, key: "PROJECT-4", is_archived: false, issue_type: type.id });
      f.presentations.push({ module_id: id, rank: "00000003", tab_hidden: false });
      f.http.tree(id, { rootIds: [], children: {}, order: [] });
    } else {
      f.http.tree(variables.parentId!, { rootIds: [id], children: { [id]: [] }, order: [id] });
    }
    const start = catalog.states.find((state) => state.id === type.start_state) ?? null;
    f.http.workItems([workItem({ id, name: variables.name, parent_id: variables.parentId, state: start, issue_type: type })]);
    const created = await f.http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
    return { create_work_item: created.work_item.nodes[0] };
  }

  const execute: typeof f.execute = async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "CreateWorkTrackerWorkItem") {
      writes.push({ operation, variables });
      return await create(variables as never) as never;
    }
    if (operation === "SetModuleLink") {
      writes.push({ operation, variables });
      return { set_module_link: { __typename: "ModuleLinks", id: "created-link", ...(variables as { moduleId: string; path: string }) } } as never;
    }
    if (operation === "WorkTrackerProjectStates") return { states } as never;
    if (operation === "WorkTrackerProjectIssueTypes") return { issue_types: issueTypes } as never;
    const data = await f.execute(document, variables);
    if (operation === "WorkTrackerProjectOpen") return { ...data, states, issue_types: issueTypes } as never;
    return data;
  };
  function mount() {
    return f.mount({ selectedTaskId: null, graphQlExecute: execute, children: <ModalHost /> });
  }
  return { ...f, execute, mount, writes };
}
