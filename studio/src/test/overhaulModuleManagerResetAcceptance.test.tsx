import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-630] refreshes complete inspection membership when the live stream resets without changing tabs", async () => {
  const boundary = storySprintModuleBoundary();
  let deliver: ((encoded: string) => void) | undefined;
  let count = 1;
  const offsets: number[] = [];
  boundary.mount({ shell: true, selectedTaskId: null,
    onGraphQlSubscribe: async (_id, request, onEvent) => {
      if (JSON.parse(request).operationName === "RunStatusStream") deliver = onEvent;
      return '{"type":"accepted"}';
    },
    graphQlExecute: async (document, variables) => {
      const operation = documentOperationName(document);
      const input = variables as { moduleId: string; offset: number };
      if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: {
        __typename: "WorktreesConnection", nodes: [], pageInfo: { __typename: "PageInfo", hasNextPage: false },
        paginationInfo: { __typename: "PaginationInfo", total: 0 },
      } } as never;
      if (operation !== "ModuleManagerInspectionStories") return boundary.execute(document, variables);
      if (input.moduleId === "module-2") offsets.push(input.offset);
      return { stories: { __typename: "WorktrackerIssueConnection", nodes: [{
        __typename: "WorktrackerIssue", id: `${input.moduleId}-reset-${input.offset}`,
        projectId: "project-1", parentId: input.moduleId, moduleId: input.moduleId, type: "task", isArchived: false,
        updatedAt: null, stateRevision: 1, sprintId: null, sprint: null,
      }], pageInfo: { __typename: "PageInfo", hasNextPage: input.offset < count - 1 },
        paginationInfo: { __typename: "PaginationInfo", total: count } } } as never;
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const row = screen.getByRole("button", { name: "Inspect bugs" }).closest("li")!;
  expect(await within(row).findByText("1 story")).toBeVisible();
  await waitFor(() => expect(deliver).toBeDefined());
  count = 2;
  const send = (frame: unknown) => deliver!(JSON.stringify({ type: "next", payload: { data: { run_status_stream: frame } } }));
  act(() => {
    send({ __typename: "RunStatusSnapshot", project_id: "project-1", cursor: 100,
      at: "2026-10-09T06:00:00Z", runs: [], automation_attempts: [] });
    send({ __typename: "RunStatusResetRequired", project_id: "project-1", cursor: 100, reason: "cursor_compacted" });
  });
  expect(await within(row).findByText("2 stories")).toBeVisible();
  expect(offsets).toEqual([0, 0, 1]);
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(boundary.calls.filter(({ operation }) => /^(Update|Reorder)/.test(operation))).toEqual([]);
});
