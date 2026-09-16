import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { studioApolloClient } from "../shared/apollo/client";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

const probe = globalThis as typeof globalThis & { __ticketrySelectionProfileProbe?: (point: string) => void };
afterEach(() => { delete probe.__ticketrySelectionProfileProbe; });

it("[overhaul-290] derives one shared module tree and delivers one-task edits through normalized fragments", async () => {
  const http = fixture();
  const ids = Array.from({ length: 30 }, (_, index) => `task-${index}`);
  http.tree("module-a", { rootIds: ids, children: Object.fromEntries(ids.map((id) => [id, []])), order: ids });
  http.workItems(ids.map((id) => workItem({ id, name: id, key: "T-1", parent_id: "module-a" })));
  const points: string[] = [];
  let requests = 0;
  probe.__ticketrySelectionProfileProbe = (point) => points.push(point);
  mountStudio({ http, selectedTaskId: ids[0], graphQlExecute: (document, variables) => {
    if (documentOperationName(document) === "WorkTrackerModuleOpen") requests++;
    return http.executeGraphQl(document, variables);
  } });
  const stories = await screen.findByRole("region", { name: "Stories" });
  await within(stories).findByRole("treeitem", { name: /task-29/ });
  await screen.findByRole("region", { name: "Details" });
  // StrictMode can replay the owner's memo, but mounting rows cannot multiply it.
  expect(points.filter((point) => point === "module-open-materialize").length).toBeLessThanOrEqual(2);
  expect(requests).toBe(1);
  points.length = 0;
  await act(async () => {
    http.revise(ids[0]!, { description: "Only the selected task changed" });
    await studioApolloClient().query({ query: WorkTrackerWorkItemDocument, variables: { id: ids[0]! }, fetchPolicy: "network-only" });
  });
  await waitFor(() => expect(screen.getByRole("region", { name: "Details" })).toHaveTextContent("Only the selected task changed"));
  expect(points.filter((point) => point === "module-open-materialize")).toHaveLength(0);
  expect(points.filter((point) => point === "task-row-render")).toHaveLength(0);
  expect(points.filter((point) => point === "work-item-row-render").length).toBeLessThanOrEqual(2);
  expect(requests).toBe(1);
});
