import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { projectOpenFixture } from "./projectOpenFixture";

afterEach(() => vi.unstubAllGlobals());

it("[overhaul-631] inspects a hidden module in the detail panel without restoring its tab or changing sprint selection", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, selectedTaskId: null });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect bugs" }));
  const detail = screen.getByRole("region", { name: "Module details: bugs" });
  expect(within(detail).getByRole("heading", { name: "bugs" })).toBeVisible();
  expect(within(detail).getByText("PROJECT-2")).toBeVisible();
  expect(within(detail).getByText("/repos/module-2")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  expect(boundary.calls.filter((call) => /^(Update|Reorder)/.test(call.operation))).toEqual([]);
});

it("[overhaul-633] completes sprint membership pagination, retries read failures and tracks agent attention from the subscription", async () => {
  const boundary = storySprintModuleBoundary();
  let deliver: ((encoded: string) => void) | undefined;
  let failPage = true;
  const storyPages: number[] = [];
  boundary.mount({ shell: true, selectedTaskId: null,
    onGraphQlSubscribe: async (_id, request, onEvent) => {
      if (JSON.parse(request).operationName === "RunStatusStream") deliver = onEvent;
      return '{"type":"accepted"}';
    },
    graphQlExecute: async (document, variables) => {
      const operation = documentOperationName(document);
      const input = variables as { moduleId: string; offset: number };
      if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: {
        __typename: "WorktreeConnection", nodes: [], pageInfo: { __typename: "PageInfo", hasNextPage: false },
        paginationInfo: { __typename: "PaginationInfo", total: 0 },
      } } as never;
      if (operation !== "ModuleManagerInspectionStories") return boundary.execute(document, variables);
      if (input.moduleId !== "module-2") return { stories: { __typename: "WorktrackerIssueConnection", nodes: [],
        pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 0 } } } as never;
      storyPages.push(input.offset);
      if (input.offset && failPage) throw new Error("Sprint membership read failed");
      const nodes = [{ __typename: "WorktrackerIssue", id: input.offset ? "detail-bugs-25" : "detail-bugs-24",
        projectId: "project-1", parentId: "module-2", moduleId: "module-2", type: "task", isArchived: false,
        updatedAt: null, stateRevision: 1, sprintId: input.offset ? "sprint-25" : "sprint-24",
        sprint: { __typename: "WorktrackerSprint", id: input.offset ? "sprint-25" : "sprint-24", name: input.offset ? "Sprint 25" : "Sprint 24" } }];
      return { stories: { __typename: "WorktrackerIssueConnection", nodes,
        pageInfo: { __typename: "PageInfo", hasNextPage: !input.offset }, paginationInfo: { __typename: "PaginationInfo", total: 2 } } } as never;
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Inspect bugs" }));
  const detail = screen.getByRole("region", { name: "Module details: bugs" });
  await within(detail).findByRole("button", { name: "Retry module details" });
  expect(within(detail).getByText("Sprint membership unavailable")).toBeVisible();
  expect(within(detail).queryByText("Sprint 24")).toBeNull();
  failPage = false;
  fireEvent.click(within(detail).getByRole("button", { name: "Retry module details" }));
  expect(await within(detail).findByText("Sprint 24")).toBeVisible();
  expect(within(detail).getByText("Sprint 25")).toBeVisible();
  expect(storyPages).toEqual([0, 1, 0, 1]);
  await waitFor(() => expect(deliver).toBeDefined());
  const send = (state: string, cursor: number) => deliver!(JSON.stringify({ type: "next", payload: { data: { run_status_stream: {
    __typename: "RunStatusSnapshot", project_id: "project-1", cursor, at: "2026-10-09T06:00:00Z", automation_attempts: [],
    runs: [{ agent_run_id: "detail-agent", project_id: "project-1", task_id: "bugs-24", module_id: "module-2", agent: "codex",
      scope: "task", started_at: "2026-10-09T06:00:00Z", updated_at: "2026-10-09T06:00:00Z", state, provider_session_id: null }],
  } } } }));
  act(() => send("working", 1));
  expect(await within(detail).findByText("codex")).toBeVisible();
  expect(within(detail).getByText("Working")).toBeVisible();
  act(() => send("needs_input", 2));
  expect(await within(detail).findByText("Needs input")).toBeVisible();
  expect(within(detail).queryByText("Working")).toBeNull();
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
});

it("[overhaul-632] returns from narrow module details with search, group state and keyboard cursor intact", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(max-width: 760px)", media,
    addEventListener: () => {}, removeEventListener: () => {} }));
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, selectedTaskId: null });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Open 1 modules" }));
  fireEvent.change(within(manager).getByRole("searchbox", { name: "Search modules" }), { target: { value: "bugs" } });
  const inspect = within(manager).getByRole("button", { name: "Inspect bugs" });
  inspect.focus();
  fireEvent.click(inspect);
  const detail = screen.getByRole("region", { name: "Module details: bugs" });
  const back = within(detail).getByRole("button", { name: "Back to modules" });
  expect(back).toHaveFocus();
  expect(within(manager).queryByRole("searchbox", { name: "Search modules" })).toBeNull();
  fireEvent.click(back);
  expect(within(manager).getByRole("searchbox", { name: "Search modules" })).toHaveValue("bugs");
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Inspect bugs" })).toHaveFocus());
  fireEvent.change(within(manager).getByRole("searchbox", { name: "Search modules" }), { target: { value: "" } });
  expect(within(manager).getByRole("button", { name: "Open 1 modules" })).toHaveAttribute("aria-expanded", "false");
  const cursor = within(manager).getByRole("button", { name: "Inspect bugs" });
  cursor.focus();
  fireEvent.keyDown(cursor, { key: "ArrowDown" });
  expect(within(manager).getByRole("button", { name: "Not in sprint 1 modules" })).toHaveFocus();
  expect(boundary.calls.filter((call) => /^(Update|Reorder)/.test(call.operation))).toEqual([]);
});

it("[overhaul-634] keeps archive details read-only and refuses to replace the next selected module with a late archive membership read", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let archivedReadStarted = false;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    const input = variables as { moduleId?: string };
    if (operation === "ModuleManagerArchivedModules") {
      const nodes = projectOpenFixture({ id: "project-1", name: "Project", slug: "PROJECT", description: "" }, [
        { ...boundary.modules[0]!, id: "archive-detail", name: "Retired module", sequence_id: 10, key: "PROJECT-10", is_archived: true },
      ]).data.modules.nodes.map((module) => ({ ...module, state_revision: 1 }));
      return { modules: { __typename: "WorktrackerIssueConnection", nodes,
        pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 1 } } } as never;
    }
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: { __typename: "WorktreeConnection", nodes: [],
      pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 0 } } } as never;
    if (operation !== "ModuleManagerInspectionStories") return boundary.execute(document, variables);
    if (input.moduleId === "archive-detail") { archivedReadStarted = true; await pending; }
    const archived = input.moduleId === "archive-detail";
    return { stories: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue",
      id: archived ? "retired-story" : "current-" + input.moduleId, projectId: "project-1", parentId: input.moduleId,
      moduleId: input.moduleId, type: "task", isArchived: false, updatedAt: null, stateRevision: 1,
      sprintId: archived ? "retired-sprint" : null, sprint: archived ? { __typename: "WorktrackerSprint", id: "retired-sprint", name: "Retired sprint" } : null }],
      pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 1 } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.change(within(manager).getByRole("searchbox", { name: "Search modules" }), { target: { value: "Retired" } });
  fireEvent.click(await within(manager).findByRole("button", { name: "Inspect Retired module" }));
  const archivedDetail = screen.getByRole("region", { name: "Module details: Retired module" });
  expect(within(archivedDetail).getByText("Archived · inspection only")).toBeVisible();
  expect(within(archivedDetail).getByText("Folder not linked")).toBeVisible();
  expect(within(archivedDetail).queryByRole("button", { name: /Open|Close tab|Restore|Rename|Archive/ })).toBeNull();
  expect(within(within(manager).getByRole("region", { name: "Archived" })).queryByRole("button", {
    name: /^(Open|Close|Restore|Rename|Archive) Retired module/,
  })).toBeNull();
  await waitFor(() => expect(archivedReadStarted).toBe(true));
  fireEvent.change(within(manager).getByRole("searchbox", { name: "Search modules" }), { target: { value: "bugs" } });
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect bugs" }));
  const currentDetail = screen.getByRole("region", { name: "Module details: bugs" });
  expect(await within(currentDetail).findByText("Unsprinted")).toBeVisible();
  await act(async () => { release(); await pending; });
  expect(screen.queryByRole("region", { name: "Module details: Retired module" })).toBeNull();
  expect(within(currentDetail).queryByText("Retired sprint")).toBeNull();
  expect(within(currentDetail).getByText("/repos/module-2")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(boundary.calls.filter((call) => /^(Update|Reorder)/.test(call.operation))).toEqual([]);
});
