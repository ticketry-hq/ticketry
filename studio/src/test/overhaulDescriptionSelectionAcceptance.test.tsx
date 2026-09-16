import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

vi.mock("../features/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
    onParseError,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
    onParseError: (markdown: string) => void;
  }) => (
    <>
      <textarea
        aria-label="Story description"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={() => onParseError(markdown)}>
        Use Markdown source
      </button>
    </>
  ),
}));

describe("overhaul acceptance — selected Story description", () => {
  it("[overhaul-248] binds the description edit session and update to the selected Story", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["story-a", "story-b"],
      children: { "story-a": [], "story-b": [] },
      order: ["story-a", "story-b"],
    });
    http.workItems([
      workItem({
        id: "story-a",
        key: "MEML-1",
        name: "Story A",
        description: "Story A saved description",
      }),
      workItem({
        id: "story-b",
        key: "MEML-2",
        name: "Story B",
        description: "Story B saved description",
      }),
    ]);
    const updates: Array<Record<string, unknown>> = [];
    const execute: typeof http.executeGraphQl = async (document, variables) => {
      if (
        documentOperationName(document) === "UpdateWorkTrackerWorkItemDetails"
      ) {
        updates.push(variables as Record<string, unknown>);
      }
      return http.executeGraphQl(document, variables);
    };
    mountStudio({
      http,
      selectedTaskId: "story-a",
      graphQlExecute: execute,
    });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = screen.getByRole("region", { name: "Details" });
    await act(() => vi.dynamicImportSettled());
    fireEvent.click(await within(details).findByTestId("issue-description"));
    fireEvent.change(await within(details).findByLabelText("Story description"), {
      target: { value: "Story A unsaved draft" },
    });

    fireEvent.click(
      await within(stories).findByRole("treeitem", { name: /Story B/ }),
    );

    expect(
      await within(details).findByText("Story B saved description"),
    ).toBeVisible();
    expect(within(details).queryByTestId("description-editor")).toBeNull();
    expect(within(details).queryByText("Story A unsaved draft")).toBeNull();

    fireEvent.click(within(details).getByTestId("issue-description"));
    expect(await within(details).findByLabelText("Story description")).toHaveValue(
      "Story B saved description",
    );
    expect(within(details).queryByDisplayValue("Story A unsaved draft")).toBeNull();

    fireEvent.click(within(details).getByRole("button", { name: "Use Markdown source" }));
    const source = await within(details).findByLabelText("Ticket description source");
    expect(source).toHaveValue("Story B saved description");
    expect(within(details).queryByDisplayValue("Story A unsaved draft")).toBeNull();

    fireEvent.change(source, { target: { value: "  Story B draft  \n" } });
    fireEvent.click(within(details).getByRole("button", { name: "Save" }));
    await http.expectPatch("story-b", { description: "Story B draft" });
    expect(await within(details).findByText("Story B draft")).toBeVisible();

    fireEvent.click(within(details).getByTestId("issue-description"));
    fireEvent.click(await within(details).findByRole("button", { name: "Save" }));
    fireEvent.click(within(details).getByTestId("issue-description"));
    fireEvent.change(await within(details).findByLabelText("Story description"), {
      target: { value: "Cancelled Story B draft" },
    });
    fireEvent.click(within(details).getByRole("button", { name: "Cancel" }));

    // Switching Stories wrote Story A's dirty draft (CODING-1525); Story B's
    // explicit Save is the only other write. Cancel wrote nothing.
    await waitFor(() => {
      expect(updates).toHaveLength(2);
      expect(updates[0]).toMatchObject({
        id: expect.stringContaining("story-a"),
        description: "Story A unsaved draft",
      });
      expect(updates[1]).toMatchObject({
        id: expect.stringContaining("story-b"),
        description: "Story B draft",
      });
    });
    expect(within(details).getByText("Story B draft")).toBeVisible();
    expect(within(details).queryByText("Cancelled Story B draft")).toBeNull();
  });
});
