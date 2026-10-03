import { gql } from "@apollo/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePlanWorkItem, usePlanWritePending } from "../features/work-items";
import { studioApolloClient } from "../shared/apollo/client";
import { fixture, mountStudio, workItem } from "./seam";
import { documentOperationName } from "../graphql-foundation/typedDocument";

const Assignment = gql`fragment PlanAssignmentAcceptance on WorktrackerIssue { id sprintId }`;
function MoveControls() {
  const plan = usePlanWorkItem(); const pending = usePlanWritePending();
  return <button disabled={pending("story-1")} onClick={() => void plan("story-1", "sprint-1")}>Assign sprint</button>;
}
describe("Plan assignment acceptance", () => {
  it("[overhaul-444] optimistically assigns, blocks another view's duplicate, and restores the cache after failure", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    http.workItems([workItem({ id: "story-1", name: "Story" })]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mountStudio({ http, children: <MoveControls />, graphQlExecute: async (document, variables) => {
      if (documentOperationName(document) === "PlanWorkItem") await gate;
      return http.executeGraphQl(document, variables);
    } });
    const client = studioApolloClient(); const id = client.cache.identify({ __typename: "WorktrackerIssue", id: "story-1" });
    client.cache.writeFragment({ id, fragment: Assignment, data: { __typename: "WorktrackerIssue", id: "story-1", sprintId: null } });
    fireEvent.click(screen.getByRole("button", { name: "Assign sprint" }));
    expect(screen.getByRole("button", { name: "Assign sprint" })).toBeDisabled();
    expect(client.cache.readFragment<{ sprintId: string | null }>({ id, fragment: Assignment, optimistic: true })?.sprintId).toBe("sprint-1");
    http.failNext(500);
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Assign sprint" })).toBeEnabled());
    expect(client.cache.readFragment<{ sprintId: string | null }>({ id, fragment: Assignment, optimistic: true })?.sprintId).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assign sprint" }));
    await http.expectPatch("story-1", { sprint_id: "sprint-1" });
    await waitFor(() => expect(client.cache.readFragment<{ sprintId: string | null }>({ id, fragment: Assignment, optimistic: true })?.sprintId).toBe("sprint-1"));
  });
});
