import type { ReactNode } from "react";
/**
 * CODING-1525 — the description editor is always live and dirty drafts are
 * written when typing pauses, when focus leaves the editor, and when the
 * person switches Stories. A rejected write keeps the draft for retry, and
 * `Saving…` shows only while a write is in flight. CODING-1549 serializes
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

function editor(details: HTMLElement) {
  return within(details).findByLabelText("Story description");
}

async function expectDescription(details: HTMLElement, text: string) {
  await waitFor(() => expect(within(details).getByLabelText("Story description")).toHaveValue(text));
}

describe("overhaul acceptance — description autosave", () => {
  it.each([false, true])("[overhaul-284] retains a failed navigation save, returning before rejection: %s", async (returnBeforeRejection) => {
    const { http, updates, releaseWrites } = mount({ failWrites: 1, holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    fireEvent.change(await editor(details), { target: { value: "Recover this draft" } });
    fireEvent.click(within(stories).getByRole("treeitem", { name: /Story B/ }));
    await waitFor(() => expect(updates).toHaveLength(1));
    if (returnBeforeRejection) {
      fireEvent.click(within(stories).getByRole("treeitem", { name: /Story A/ }));
      await expectDescription(details, "Recover this draft");
    }
    releaseWrites();
    await waitFor(() => expect(useClientStore.getState().toasts.at(-1)?.message)
      .toContain("description write refused"));
    if (!returnBeforeRejection) {
      fireEvent.click(within(stories).getByRole("treeitem", { name: /Story A/ }));
    }
    await expectDescription(details, "Recover this draft");
    expect(await within(details).findByRole("alert")).toHaveTextContent("description write refused");

    fireEvent.blur(await editor(details), { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Recover this draft" });
    await waitFor(() => expect(within(details).queryByRole("alert")).toBeNull());
  });

  // CODING-1549: writes for one Story never overlap. A boundary reached while
  // a write is in flight queues one follow-up carrying the newest draft.
  it("[overhaul-286] serializes same-Story writes so the newest draft persists last", async () => {
    const { http, updates, releaseWrites } = mount({ holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const field = await editor(details);
    fireEvent.change(field, { target: { value: "Draft A" } });
    fireEvent.blur(field, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(1));

    fireEvent.change(field, { target: { value: "Draft B" } });
    fireEvent.blur(field, { relatedTarget: stories });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).toHaveLength(1);

    releaseWrites();
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Draft B" });
    expect(updates.map((call) => call.description)).toEqual(["Draft A", "Draft B"]);
    await expectDescription(details, "Draft B");
  });

  it("[CODING-1549 b] an older rejection leaves the newer pending draft available and saveable", async () => {
    const { http, updates, releaseWrites } = mount({ failWrites: 1, holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const field = await editor(details);
    fireEvent.change(field, { target: { value: "Draft A" } });
    fireEvent.blur(field, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(1));
    fireEvent.change(field, { target: { value: "Draft B" } });
    fireEvent.blur(field, { relatedTarget: stories });

    releaseWrites();
    expect(await within(details).findByRole("alert")).toHaveTextContent("description write refused");
    await expectDescription(details, "Draft B");
    expect(updates).toHaveLength(1);

    fireEvent.blur(field, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Draft B" });
    await waitFor(() => expect(within(details).queryByRole("alert")).toBeNull());
  });

  it("[CODING-1549 c] switching Stories while a write is pending keeps the newest draft on the original Story", async () => {
    const { http, updates, releaseWrites } = mount({ holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const field = await editor(details);
    fireEvent.change(field, { target: { value: "Draft A" } });
    fireEvent.blur(field, { relatedTarget: stories });
    await waitFor(() => expect(updates).toHaveLength(1));
    fireEvent.change(field, { target: { value: "Draft B" } });
    fireEvent.click(within(stories).getByRole("treeitem", { name: /Story B/ }));
    await expectDescription(details, "Story B saved");

    releaseWrites();
    await waitFor(() => expect(updates).toHaveLength(2));
    releaseWrites();
    await http.expectPatch("story-a", { description: "Draft B" });
    expect(updates.map((call) => call.id)).toEqual(["story-a", "story-a"]);

    fireEvent.click(within(stories).getByRole("treeitem", { name: /Story A/ }));
    await expectDescription(details, "Draft B");
  });

  it("[CODING-1525 a] switching Stories writes the previous dirty draft and starts fresh", async () => {
    const { http, updates } = mount();
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    fireEvent.change(await editor(details), { target: { value: "Story A draft" } });

    fireEvent.click(await within(stories).findByRole("treeitem", { name: /Story B/ }));

    await http.expectPatch("story-a", { description: "Story A draft" });
    await expectDescription(details, "Story B saved");
    expect(within(stories).queryByText(/Story A draft/)).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("[CODING-1525 b] a typing pause writes the draft; focus leaving writes it at once; opening writes nothing", async () => {
    const { http, updates } = mount();
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const field = await editor(details);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(updates).toHaveLength(0);

    fireEvent.change(field, { target: { value: "Story A paused draft" } });
    expect(updates).toHaveLength(0);
    await http.expectPatch("story-a", { description: "Story A paused draft" });
    expect(updates).toHaveLength(1);

    fireEvent.change(field, { target: { value: "Story A blurred draft" } });
    fireEvent.blur(field, { relatedTarget: stories });
    await http.expectPatch("story-a", { description: "Story A blurred draft" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(updates).toHaveLength(2);
  });

  it("[CODING-1525 c] a rejected write keeps the draft, shows an inline error, and the next boundary retries", async () => {
    const { http, updates } = mount({ failWrites: 1 });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const field = await editor(details);
    fireEvent.change(field, { target: { value: "Story A retry draft" } });
    fireEvent.blur(field, { relatedTarget: stories });

    const alert = await within(details).findByRole("alert");
    expect(alert).toHaveTextContent(/description write refused/);
    await expectDescription(details, "Story A retry draft");
    expect(useClientStore.getState().toasts.at(-1)?.message).toContain("description write refused");

    fireEvent.blur(field, { relatedTarget: stories });
    await http.expectPatch("story-a", { description: "Story A retry draft" });
    await waitFor(() => expect(within(details).queryByRole("alert")).toBeNull());
    expect(updates).toHaveLength(2);
  });

  it("[CODING-1525 d] shows Saving… only while a write is in flight", async () => {
    const { releaseWrites } = mount({ holdWrites: true });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const details = await screen.findByRole("region", { name: "Details" });
    const field = await editor(details);
    fireEvent.change(field, { target: { value: "Story A slow draft" } });
    expect(within(details).queryByText("Saving…")).toBeNull();

    fireEvent.blur(field, { relatedTarget: stories });
    expect(await within(details).findByText("Saving…")).toBeVisible();

    releaseWrites();
    await waitFor(() => expect(within(details).queryByText("Saving…")).toBeNull());
    await expectDescription(details, "Story A slow draft");
  });

  it("[CODING-1525 e] source fallback follows the same rules and typing never moves the selection", async () => {
    const { http } = mount();
    const details = await screen.findByRole("region", { name: "Details" });
    const stories = await screen.findByRole("region", { name: "Stories" });
    const field = await editor(details);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "j" });
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
