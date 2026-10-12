import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const storyTypeId = "22222222-2222-2222-2222-222222222222";
const implementationTypeId = "33333333-3333-3333-3333-333333333333";

// The server serializes UUID scalars without separators, including nested rows.
function serverIds(value: unknown): unknown {
  if (typeof value === "string") {
    return value === storyTypeId || value === implementationTypeId
      ? value.replace(/-/g, "")
      : value;
  }
  if (Array.isArray(value)) return value.map(serverIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, serverIds(row)]));
  }
  return value;
}

describe("overhaul acceptance — public issue-type identities", () => {
  it("[overhaul-467] resolves compact server issue types in Details, Story actions, and Review findings", async () => {
    const http = fixture();
    const story = { id: storyTypeId, name: "Story", level: "task" as const };
    const implementation = { id: implementationTypeId, name: "Implementation", level: "task" as const };
    const ideas = { id: "ideas", name: "Ideas", group: "backlog" };
    const review = { id: "review", name: "Review", group: "started" };
    const implement = { id: "implement", name: "Implement", group: "started" };
    http.tree("module-1", {
      rootIds: ["idea-story", "review-story"],
      children: { "idea-story": [], "review-story": ["finding"], finding: [] },
      order: ["idea-story", "review-story", "finding"],
    });
    http.workItems([
      workItem({ id: "idea-story", name: "Story idea", issue_type_id: story, state_id: ideas }),
      workItem({
        id: "review-story", name: "Reviewed story", issue_type_id: story,
        state_id: review, has_children: true, sub_issues_count: 1,
      }),
      workItem({
        id: "finding", name: "Repair the catalog", sequence_id: 3,
        issue_type_id: implementation, state_id: implement, parent_id: "review-story",
      }),
    ]);
    mountStudio({
      http,
      selectedTaskId: "idea-story",
      graphQlExecute: async <TResult, TVariables>(
        document: TypedDocumentNode<TResult, TVariables>,
        variables: TVariables,
      ) => serverIds(await http.executeGraphQl(document, variables)) as TResult,
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const selectedType = () => within(within(details).getByTestId("issue-type-picker")).getByRole("button");
    await waitFor(() => expect(selectedType()).toHaveTextContent("Story"));
    expect(selectedType()).not.toHaveTextContent("Unknown type");
    expect(within(details).getByRole("button", { name: "Story workflow guide" })).toBeVisible();
    expect(await within(details).findByRole("button", { name: "Run now" })).toBeVisible();

    act(() => useClientStore.getState().selectTask("review-story"));
    const findings = await within(details).findByTestId("findings-panel");
    expect(within(findings).getByTestId("findings-queued-count")).toHaveTextContent("1 fix queued");
    expect(within(findings).getByRole("button", { name: /Repair the catalog/ })).toBeVisible();
    expect(within(findings).getByTestId("finding-state")).toHaveTextContent("Implement");
    expect(selectedType()).toHaveTextContent("Story");
  });
});
