/**
 * CODING-1525 — dirty description drafts are written at editor boundaries:
 * switching Stories and moving focus out of the editor. Cancel stays the
 * explicit discard, a rejected write keeps the draft for retry, and
 * `saving…` shows only while a write is in flight. CODING-1549 serializes
 * same-Story writes so the newest draft always persists last.
 */
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
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

// Story switches load the Details view lazily; give them room under full-suite load.
configure({ asyncUtilTimeout: 5000 });

const UPDATE = "UpdateWorkTrackerWorkItemDetails";

function mount(options: { failWrites?: number; holdWrites?: boolean } = {}) {
  const http = fixture();
  http.tree("module-1", {
    rootIds: ["story-a", "story-b"],
    children: { "story-a": [], "story-b": [] },
    order: ["story-a", "story-b"],
  });
  http.workItems([
    workItem({ id: "story-a", key: "MEML-1", name: "Story A", description: "Story A saved" }),
    workItem({ id: "story-b", key: "MEML-2", name: "Story B", description: "Story B saved" }),
  ]);
  const updates: Array<Record<string, unknown>> = [];
  const held: Array<() => void> = [];
  let failuresLeft = options.failWrites ?? 0;
  const execute: typeof http.executeGraphQl = async (document, variables) => {
    if (documentOperationName(document) === UPDATE) {
      updates.push(variables as Record<string, unknown>);
      if (options.holdWrites) await new Promise<void>((resolve) => held.push(resolve));
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("description write refused");
      }
    }
    return http.executeGraphQl(document, variables);
  };
  mountStudio({ http, selectedTaskId: "story-a", graphQlExecute: execute });
  return {
    http,
    updates,
    releaseWrites: () => { for (const release of held.splice(0)) release(); },
  };
}

async function openEditor(details: HTMLElement) {
  fireEvent.click(await within(details).findByTestId("issue-description"));
  return within(details).findByLabelText("Story description");
}

describe("overhaul acceptance — description autosave at editor boundaries", () => {
  it.each([false, true])("[overhaul-284] retains a failed navigation save, returning before rejection: %s", async (returnBeforeRejection) => {
    const { http, updates, releaseWrites } = mount({ failWrites: 1, holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    fireEvent.change(await openEditor(details), { target: { value: "Recover this draft" } });
    fireEvent.click(within(stories).getByRole("treeitem", { name: /Story B/ }));
    await waitFor(() => expect(updates).toHaveLength(1));
    if (returnBeforeRejection) {
      fireEvent.click(within(stories).getByRole("treeitem", { name: /Story A/ }));
      expect(await openEditor(details)).toHaveValue("Recover this draft");
    }
    releaseWrites();
    await waitFor(() => expect(useClientStore.getState().toasts.at(-1)?.message)
      .toContain("description write refused"));
    if (!returnBeforeRejection) {
      fireEvent.click(within(stories).getByRole("treeitem", { name: /Story A/ }));
    }
    expect(await within(details).findByLabelText("Story description")).toHaveValue("Recover this draft");
    expect(await within(details).findByRole("alert")).toHaveTextContent("description write refused");

    fireEvent.click(within(details).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Recover this draft" });
    expect(await within(details).findByText("Recover this draft")).toBeVisible();
  });

  // CODING-1549: writes for one Story never overlap. A boundary reached while
  // a write is in flight queues one follow-up carrying the newest draft.
  it("[overhaul-286] serializes same-Story writes so the newest draft persists last", async () => {
    const { http, updates, releaseWrites } = mount({ holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const editor = await openEditor(details);
    fireEvent.change(editor, { target: { value: "Draft A" } });
    fireEvent.blur(editor, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(1));

    fireEvent.change(editor, { target: { value: "Draft B" } });
    fireEvent.blur(editor, { relatedTarget: stories });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).toHaveLength(1);

    releaseWrites();
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Draft B" });
    expect(updates.map((call) => call.description)).toEqual(["Draft A", "Draft B"]);
    expect(within(details).getByLabelText("Story description")).toHaveValue("Draft B");
  });

  it("[CODING-1549 b] an older rejection leaves the newer pending draft available and saveable", async () => {
    const { http, updates, releaseWrites } = mount({ failWrites: 1, holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const editor = await openEditor(details);
    fireEvent.change(editor, { target: { value: "Draft A" } });
    fireEvent.blur(editor, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(1));
    fireEvent.change(editor, { target: { value: "Draft B" } });
    fireEvent.click(within(details).getByRole("button", { name: "Save" }));

    releaseWrites();
    expect(await within(details).findByRole("alert")).toHaveTextContent("description write refused");
    expect(within(details).getByLabelText("Story description")).toHaveValue("Draft B");
    expect(updates).toHaveLength(1);

    fireEvent.click(within(details).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Draft B" });
    expect(await within(details).findByText("Draft B")).toBeVisible();
    expect(within(details).queryByRole("alert")).toBeNull();
  });

  it("[CODING-1549 c] switching Stories while a write is pending keeps the newest draft on the original Story", async () => {
    const { http, updates, releaseWrites } = mount({ holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const editor = await openEditor(details);
    fireEvent.change(editor, { target: { value: "Draft A" } });
    fireEvent.blur(editor, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(1));
    fireEvent.change(editor, { target: { value: "Draft B" } });
    fireEvent.click(within(stories).getByRole("treeitem", { name: /Story B/ }));
    expect(await within(details).findByText("Story B saved")).toBeVisible();

    releaseWrites();
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Draft B" });
    expect(updates.map((call) => call.id)).toEqual(["story-a", "story-a"]);

    fireEvent.click(within(stories).getByRole("treeitem", { name: /Story A/ }));
    expect(await within(details).findByText("Draft B")).toBeVisible();
    expect(await openEditor(details)).toHaveValue("Draft B");
  });

  it("[CODING-1525 a] switching Stories writes the previous dirty draft and starts fresh", async () => {
    const { http, updates } = mount();
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    fireEvent.change(await openEditor(details), { target: { value: "Story A draft" } });

    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Story B/ }));

    await http.expectPatch("story-a", { description: "Story A draft" });
    expect(await within(details).findByText("Story B saved")).toBeVisible();
    expect(within(details).queryByTestId("description-editor")).toBeNull();
    expect(within(stories).queryByText(/Story A draft/)).toBeNull();

    expect(await openEditor(details)).toHaveValue("Story B saved");
    expect(updates).toHaveLength(1);
  });

  it("[CODING-1525 b] focus leaving the editor writes the draft; Cancel discards; no-change Save is silent", async () => {
    const { http, updates } = mount();
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const editor = await openEditor(details);
    fireEvent.change(editor, { target: { value: "Story A blurred draft" } });

    fireEvent.blur(editor, { relatedTarget: stories });
    await http.expectPatch("story-a", { description: "Story A blurred draft" });
    expect(updates).toHaveLength(1);

    // A no-change Save after the autosave sends nothing.
    fireEvent.click(within(details).getByRole("button", { name: "Save" }));
    expect(await within(details).findByText("Story A blurred draft")).toBeVisible();

    fireEvent.change(await openEditor(details), { target: { value: "Cancelled draft" } });
    fireEvent.click(within(details).getByRole("button", { name: "Cancel" }));
    expect(await within(details).findByText("Story A blurred draft")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).toHaveLength(1);
  });

  it("[CODING-1525 c] a rejected write keeps edit mode and the draft, shows an inline error, and Save retries", async () => {
    const { http, updates } = mount({ failWrites: 1 });
    const details = await screen.findByRole("region", { name: "Details" });
    const editor = await openEditor(details);
    fireEvent.change(editor, { target: { value: "Story A retry draft" } });
    fireEvent.click(within(details).getByRole("button", { name: "Save" }));

    const alert = await within(details).findByRole("alert");
    expect(alert).toHaveTextContent(/description write refused/);
    expect(within(details).getByLabelText("Story description")).toHaveValue("Story A retry draft");
    expect(useClientStore.getState().toasts.at(-1)?.message).toContain("description write refused");

    fireEvent.click(within(details).getByRole("button", { name: "Save" }));
    await http.expectPatch("story-a", { description: "Story A retry draft" });
    expect(await within(details).findByText("Story A retry draft")).toBeVisible();
    expect(within(details).queryByRole("alert")).toBeNull();
    expect(updates).toHaveLength(2);
  });

  it("[CODING-1525 d] shows saving… only while a write is in flight", async () => {
    const { releaseWrites } = mount({ holdWrites: true });
    const details = await screen.findByRole("region", { name: "Details" });
    fireEvent.change(await openEditor(details), { target: { value: "Story A slow draft" } });
    expect(within(details).queryByText("saving…")).toBeNull();

    fireEvent.click(within(details).getByRole("button", { name: "Save" }));
    expect(await within(details).findByText("saving…")).toBeVisible();

    releaseWrites();
    await waitFor(() => expect(within(details).queryByText("saving…")).toBeNull());
    expect(within(details).getByText("Story A slow draft")).toBeVisible();
  });

  it("[CODING-1525 e] source fallback follows the same rules and typing never moves the selection", async () => {
    const { http } = mount();
    const details = await screen.findByRole("region", { name: "Details" });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const editor = await openEditor(details);
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(editor, { key: "j" });
    expect(within(details).getByLabelText("Story description")).toBeVisible();

    fireEvent.click(within(details).getByRole("button", { name: "Use Markdown source" }));
    const source = await within(details).findByLabelText("Ticket description source");
    fireEvent.change(source, { target: { value: "Story A source draft" } });
    fireEvent.keyDown(source, { key: "ArrowDown" });
    expect(within(details).getByLabelText("Ticket description source")).toHaveValue("Story A source draft");

    fireEvent.blur(source, { relatedTarget: stories });
    await http.expectPatch("story-a", { description: "Story A source draft" });
    expect(within(details).getByLabelText("Ticket description source")).toHaveValue("Story A source draft");
  });
});
