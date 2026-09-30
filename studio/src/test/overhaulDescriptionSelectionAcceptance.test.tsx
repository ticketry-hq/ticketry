import type { ReactNode } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

vi.mock("../features/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
    onParseError,
    toolbarActions,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
    onParseError: (markdown: string) => void;
    toolbarActions?: ReactNode;
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
      {toolbarActions}
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
    const description = await within(details).findByTestId("issue-description");
    const storyRow = await within(stories).findByRole("treeitem", { name: /Story A/ });
    expect(storyRow.querySelector("[data-task-name]")).toHaveClass("font-mono", "font-normal");
    expect(description.closest(".font-mono")).toHaveClass("font-normal");
    fireEvent.change(await within(details).findByLabelText("Story description"), {
      target: { value: "Story A unsaved draft" },
    });

    fireEvent.click(
      await within(stories).findByRole("treeitem", { name: /Story B/ }),
    );

    await waitFor(() =>
      expect(within(details).getByLabelText("Story description")).toHaveValue(
        "Story B saved description",
      ),
    );
    expect(within(details).queryByDisplayValue("Story A unsaved draft")).toBeNull();

    fireEvent.click(within(details).getByRole("button", { name: "Use Markdown source" }));
    const source = await within(details).findByLabelText("Ticket description source");
    expect(source).toHaveValue("Story B saved description");
    expect(within(details).queryByDisplayValue("Story A unsaved draft")).toBeNull();

    fireEvent.change(source, { target: { value: "  Story B draft  \n" } });
    fireEvent.blur(source, { relatedTarget: stories });
    await http.expectPatch("story-b", { description: "Story B draft" });

    // Switching Stories wrote Story A's dirty draft (CODING-1525); Story B's
    // blur is the only other write.
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
  });
});
