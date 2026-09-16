import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { loadModuleTree } from "../features/work-items/queries";
import { WorkTrackerModuleOpenDocument } from "../features/work-items/generated/workItems.documents";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

it("removes an archived Story from the shared list after a membership refresh", async () => {
  const http = fixture();
  http.tree("module-1", {
    rootIds: ["archive-story", "keep-story"],
    children: { "archive-story": [], "keep-story": [] },
    order: ["archive-story", "keep-story"],
  });
  http.workItems([
    workItem({ id: "archive-story", name: "Archive this Story" }),
    workItem({ id: "keep-story", name: "Keep this Story" }),
  ]);
  mountStudio({ http });
  const stories = await screen.findByRole("region", { name: "Stories" });
  await within(stories).findByRole("treeitem", { name: /Archive this Story/ });

  http.revise("archive-story", { is_archived: true });
  http.tree("module-1", {
    rootIds: ["keep-story"],
    children: { "keep-story": [] },
    order: ["keep-story"],
  });
  act(() => http.notifications.workItemChanged("archive-story", 2, true));

  await waitFor(() => {
    expect(within(stories).queryByRole("treeitem", { name: /Archive this Story/ })).toBeNull();
    expect(within(stories).getByRole("treeitem", { name: /Keep this Story/ })).toBeVisible();
  });
});

it("[overhaul-285] moves a Story through the sidebar and refreshes both cached modules", async () => {
  const http = fixture();
  const empty = { rootIds: [], children: {}, order: [] };
  const populated = { rootIds: ["moving-story"], children: { "moving-story": [] }, order: ["moving-story"] };
  http.tree("module-a", populated);
  http.tree("module-b", empty);
  http.workItems([workItem({ id: "moving-story", name: "Moving Story", parent_id: "module-a" })]);
  const reads: string[] = [];
  const execute: typeof http.executeGraphQl = (document, variables) => {
    if (documentOperationName(document) === "ReparentWorkTrackerWorkItem") {
      // The backend repairs module ancestry before returning the changed row.
      http.tree("module-a", empty);
      http.tree("module-b", populated);
    }
    if (documentOperationName(document) === "WorkTrackerModuleOpen") {
      reads.push((variables as { moduleId: string }).moduleId);
    }
    return http.executeGraphQl(document, variables);
  };
  mountStudio({ http, selectedTaskId: "moving-story", graphQlExecute: execute });
  const details = await screen.findByRole("region", { name: "Details" });
  const picker = await within(details).findByTestId("parent-picker");
  await act(async () => { await loadModuleTree("project-1", "module-b"); });
  reads.length = 0;

  fireEvent.click(within(picker).getByRole("button"));
  fireEvent.click(await within(picker).findByRole("button", { name: /Module 2/ }));
  await http.expectPatch("moving-story", { parent_id: "module-b" });
  const members = (moduleId: string) => studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
  })?.work_items.nodes.map((row) => row.id);
  await waitFor(() => {
    expect(members("module-a")).toEqual([]);
    expect(members("module-b")).toEqual(["moving-story"]);
  });
  expect(reads).toEqual(expect.arrayContaining(["module-a", "module-b"]));
  act(() => useClientStore.setState({ selectedModuleId: "module-b" }));
  const stories = await screen.findByRole("region", { name: "Stories" });
  expect(await within(stories).findByRole("treeitem", { name: /Moving Story/ })).toBeVisible();
});
