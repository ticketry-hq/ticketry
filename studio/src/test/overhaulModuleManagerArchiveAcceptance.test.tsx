import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { projectOpenFixture } from "./projectOpenFixture";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-612] reads every archive page through project-scoped GraphQL, retries failure and searches collapsed archives without adding tabs", async () => {
  const boundary = storySprintModuleBoundary();
  const archives = ["Retired Alpha", "Retired Beta"].map((name, index) => ({
    ...boundary.modules[0]!, id: `archive-${index}`, name, sequence_id: 20 + index,
    key: `PROJECT-${20 + index}`, is_archived: true,
  }));
  const reads: Array<{ projectId: string; offset: number; limit: number }> = [];
  let fail = true;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ModuleManagerArchivedModules") return boundary.execute(document, variables);
    const input = variables as { projectId: string; offset: number; limit: number };
    reads.push(input);
    if (input.offset === 1 && fail) { fail = false; throw new Error("Archive page offline"); }
    const rows = projectOpenFixture({ id: "project-1", slug: "PROJECT", name: "Project", description: "" }, archives.slice(input.offset, input.offset + 1)).data.modules.nodes;
    return { modules: { __typename: "WorktrackerIssueConnection", nodes: rows.map((row) => ({ ...row, state_revision: 1 })),
      pageInfo: { __typename: "PageInfo", hasNextPage: input.offset === 0 },
      paginationInfo: { __typename: "PaginationInfo", total: 2 } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(await within(manager).findByText(/Archive page offline/)).toBeVisible();
  fireEvent.click(within(manager).getByRole("button", { name: /Retry archived modules/ }));
  await waitFor(() => expect(reads.filter((read) => read.offset === 1)).toHaveLength(2));
  const search = within(manager).getByRole("searchbox", { name: "Search modules" });
  fireEvent.change(search, { target: { value: "retired" } });
  expect(await within(manager).findByRole("button", { name: "Inspect Retired Alpha" })).toBeVisible();
  expect(within(manager).getByRole("button", { name: "Inspect Retired Beta" })).toBeVisible();
  expect(within(manager).queryByRole("button", { name: "Open Retired Alpha" })).toBeNull();
  expect(screen.queryByRole("tab", { name: /Retired/ })).toBeNull();
  expect(reads.every((read) => read.projectId === "project-1" && read.limit === 100)).toBe(true);
  fireEvent.change(search, { target: { value: "" } });
  expect(within(manager).queryByRole("button", { name: "Inspect Retired Alpha" })).toBeNull();
});
