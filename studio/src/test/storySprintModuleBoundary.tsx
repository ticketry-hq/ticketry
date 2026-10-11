import { createRef, type ReactNode } from "react";
import { render } from "@testing-library/react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, workItem, type HttpFixture } from "./seam";
import { projectOpenFixture } from "./projectOpenFixture";
import { TicketWorkspace } from "../app/shell/ticket-workspace/TicketWorkspace";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { StoriesTreeProvider, useStoriesTree } from "../features/work-items";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects";
import { loadModules } from "../features/projects/queries";
import { loadModuleTree } from "../features/work-items/queries";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import { useClientStore } from "../state/clientStore";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { usePlanWorkspace } from "../features/sprints";
import { useChangesWorkspace } from "../features/agents/worktrees";
import { StudioShell } from "../app/shell/StudioShell";
import type { Module, ModulePresentation } from "../shared/api/types";

function Keyboard() { const { rows } = useStoriesTree(); useGlobalKeymap(rows); return null; }

/** Real shell/cache seam; only the generated GraphQL transport is substituted. */
export function storySprintModuleBoundary() {
  const http = fixture();
  const modules: Module[] = ["Roadmap", "bugs", "0.2.0"].map((name, index) => ({
    id: `module-${index + 1}`, name, project_id: "project-1", sequence_id: index + 1,
    key: `PROJECT-${index + 1}`, is_archived: false, issue_type: "module",
  }));
  const presentations: ModulePresentation[] = modules.map((module, index) => ({
    module_id: module.id, rank: String(index).padStart(8, "0"), tab_hidden: index === 1,
  }));
  http.storySprints([
    { id: "sprint-24", projectId: "project-1", name: "Sprint 24", status: "active" },
    { id: "sprint-25", projectId: "project-1", name: "Sprint 25", status: "planned", rank: "V", createdAt: "2026-01-02T00:00:00Z" },
    { id: "sprint-empty", projectId: "project-1", name: "Empty sprint", status: "planned", rank: "V", createdAt: "2026-01-03T00:00:00Z" },
  ]);
  const items = [
    workItem({ id: "roadmap-24", name: "Roadmap current story", parent_id: "module-1", sprint_id: "sprint-24" }),
    workItem({ id: "bugs-24", name: "Bugs current story", parent_id: "module-2", sprint_id: "sprint-24" }),
    workItem({ id: "bugs-25", name: "Bugs next story", parent_id: "module-2", sprint_id: "sprint-25", rank: "b" }),
    workItem({ id: "release-25", name: "Release next story", parent_id: "module-3", sprint_id: "sprint-25" }),
  ];
  http.workItems(items);
  modules.forEach((module) => { const ids = items.filter((item) => item.parent_id === module.id).map((item) => item.id);
    http.tree(module.id, { rootIds: ids, children: Object.fromEntries(ids.map((id) => [id, []])), order: ids }); });
  const calls: Array<{ operation: string; variables: unknown }> = [];
  const execute: HttpFixture["executeGraphQl"] = async (document, variables) => {
    const operation = documentOperationName(document); calls.push({ operation, variables });
    if (operation === "WorkTrackerProjectOpen") {
      const base = await http.executeGraphQl(document, variables) as any;
      const data = projectOpenFixture({ id: "project-1", name: "Project", slug: "PROJECT", description: "", manual_module_order: true }, modules).data;
      return { ...base, modules: data.modules, module_presentations: { ...data.module_presentations,
        nodes: data.module_presentations.nodes.map((row: any) => ({ ...row, ...presentations.find((entry) => entry.module_id === row.module_id) })) } } as never;
    }
    if (operation === "UpdateWorkTrackerModulePresentation") {
      const input = variables as { moduleId: string; tabHidden: boolean };
      const row = presentations.find((entry) => entry.module_id === input.moduleId)!;
      presentations[presentations.indexOf(row)] = { ...row, tab_hidden: input.tabHidden };
      return { update_module_presentation: { __typename: "WorktrackerModulepresentation", ...row, tab_hidden: input.tabHidden } } as never;
    }
    if (operation === "SprintChoicePage") {
      const input = variables as { filters: { status: { eq: string } }; pagination: { offset: { offset: number; limit: number } } };
      const nodes = input.filters.status.eq === "planned" ? [
        { __typename: "WorktrackerSprint", id: "sprint-25", projectId: "project-1", name: "Sprint 25", status: "planned", rank: "V", createdAt: "2026-01-02T00:00:00Z" },
        { __typename: "WorktrackerSprint", id: "sprint-empty", projectId: "project-1", name: "Empty sprint", status: "planned", rank: "V", createdAt: "2026-01-03T00:00:00Z" },
      ] : [];
      return { sprints: { __typename: "WorktrackerSprintConnection", nodes: nodes.slice(input.pagination.offset.offset, input.pagination.offset.offset + input.pagination.offset.limit),
        pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: nodes.length } } } as never;
    }
    const data = await http.executeGraphQl(document, variables) as any;
    const connection = operation === "WorkTrackerModuleOpen" ? data.module : operation === "ProjectStorySprintModules" ? data.modules : null;
    if (connection) connection.nodes = connection.nodes.map((row: any) => ({ ...row, name: modules.find((entry) => entry.id === row.id)?.name ?? row.name }));
    return data;
  };
  function mount({ selectedModuleId = "module-1", selectedTaskId = "roadmap-24", children,
    graphQlExecute = execute, onGraphQlSubscribe, unlinked = [], shell = false }: { selectedModuleId?: string | null; selectedTaskId?: string | null;
      sidebar?: boolean; children?: ReactNode; graphQlExecute?: HttpFixture["executeGraphQl"];
      onGraphQlSubscribe?: (id: string, request: string, onEvent: (encoded: string) => void) => Promise<string>;
      unlinked?: string[]; shell?: boolean } = {}) {
    Element.prototype.scrollIntoView = () => {};
    const browser = createBrowserRuntime({ environment: {} });
    const graphQlProxy = () => ({
      graphql_execute: async (json: string) => { const request = JSON.parse(json); return JSON.stringify({ data: await graphQlExecute({ kind: "Document", operationName: request.operationName, source: request.query }, request.variables) }); },
      graphql_subscribe: onGraphQlSubscribe ?? (async () => "subscription"), graphql_unsubscribe: async () => true,
    });
    initializeStudioRuntime({ ...browser, platform: "desktop", graphQlTransport: graphQlProxy,
      ...(onGraphQlSubscribe ? { statusStream: () => graphQlProxy } : {}),
      readWorkTracker: (routes) => routes.graphQl(graphQlExecute), writeWorkTracker: (routes) => routes.graphQl(graphQlExecute),
      readSettings: (routes) => routes.graphQl(graphQlExecute), writeSettings: (routes) => routes.graphQl(graphQlExecute) });
    seedModuleLinks(modules.filter((module) => !unlinked.includes(module.id)).map((module) => ({ id: `link-${module.id}`, moduleId: module.id, path: `/repos/${module.id}` })));
    useStudioStore.setState({ selectedProjectId: "project-1", activeView: "backlog", error: null });
    useClientStore.setState({ selectedModuleId, selectedTaskId, workspaceSelection: { kind: "task" }, storySearchQuery: "", 
      expandedIdsByModule: {}, collapsedStateIds: new Set(), toasts: [], dialogs: [], workspaces: {} });
    useModalStore.setState({ modalStack: [] });
    usePlanWorkspace.setState({ active: false });
    useChangesWorkspace.setState({ active: false, moduleId: null });
    useAgentStatusStore.setState({ projectId: "project-1", runs: {}, automationAttempts: {}, automationByTask: {} });
    void loadModules("project-1"); if (selectedModuleId) void loadModuleTree("project-1", selectedModuleId);
    if (shell) return render(<StudioApolloProvider><StudioShell />{children}</StudioApolloProvider>);
    return render(<StudioApolloProvider><StoriesTreeProvider><Keyboard />
      <TicketWorkspace tasksSize={40} workspaceSize={60} groupRef={createRef<ImperativePanelGroupHandle>()} onLayout={() => {}} />{children}
    </StoriesTreeProvider></StudioApolloProvider>);
  }
  return { http, execute, mount, modules, presentations, calls };
}
