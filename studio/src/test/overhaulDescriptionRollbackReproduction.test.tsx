/**
 * CODING-1524 — instrumented reproduction of the saved-description rollback.
 *
 * Observed sequence (recorded by the `journal` in each scenario; the evidence
 * tests assert it verbatim):
 *
 *   1. fact      work_item.changed for a Story in the open module (agent write)
 *   2. request   WorkTrackerWorkItem / WorkTrackerModuleOpen (network-only,
 *                issued by the fact invalidator 50 ms later; the server reads
 *                the OLD description at this moment, the response is slow)
 *   3. request   UpdateWorkTrackerWorkItemDetails { description: "Saved…" }
 *   4. response  UpdateWorkTrackerWorkItemDetails → description "Saved…"
 *                Details view shows "Saved…". The mutation's own fact
 *                (occurredAt == updated_at) is consumed and refetches nothing.
 *   5. response  the read from step 2 lands → description "Original…"
 *                Apollo writes the older row over the newer one. Rollback.
 *
 * CODING-1526: every row now carries `stateRevision`, and the WorktrackerIssue
 * type policy keeps the cached row when a lower revision arrives, so step 5
 * lands without repainting. The evidence tests keep the recorded wire order
 * and assert the saved description stays visible.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { fixture, mountStudio, workItem, type StudioFixture } from "./seam";
import {
  resetFactCursor,
  statusFeedTransport,
  workItemChangedFact,
} from "./statusStreamFeedFixture";

vi.mock("../features/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label="Story description"
      value={markdown}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const PROJECT = "project-1"; // the seam workItem() default
const ORIGINAL = "Original description";
const SAVED = "Saved description";
const SAVED_AT = "2026-08-06T12:00:00Z"; // the fixture's constant updated_at

/** The description for story-a carried by one GraphQL response, if any. */
function descriptionIn(operation: string, result: unknown): string | null {
  const data = result as Record<string, { nodes?: Array<{ id: string; description: string }> } & { description?: string }>;
  switch (operation) {
    case "WorkTrackerWorkItem":
      return data.work_item?.nodes?.find((row) => row.id === "story-a")?.description ?? null;
    case "WorkTrackerModuleOpen":
      return data.work_items?.nodes?.find((row) => row.id === "story-a")?.description ?? null;
    case "UpdateWorkTrackerWorkItemDetails":
      return data.update_work_item?.description ?? null;
    default:
      return null;
  }
}

/**
 * Wraps the fixture's GraphQL execution so every request and response is
 * journaled in arrival order, and so reads issued after `holdReads()` are
 * answered by the server immediately (snapshotting what it holds *now*) but
 * delivered to the client only when `releaseReads()` is called — a slow read.
 */
function instrument(http: StudioFixture) {
  const journal: string[] = [];
  const held: Array<() => void> = [];
  let holding = false;
  const execute: typeof http.executeGraphQl = async (document, variables) => {
    const operation = documentOperationName(document);
    const isRead = operation === "WorkTrackerWorkItem" || operation === "WorkTrackerModuleOpen";
    const wasHeld = holding && isRead;
    journal.push(`request  ${operation} ${JSON.stringify(variables)}`);
    const result = await http.executeGraphQl(document, variables);
    if (wasHeld) await new Promise<void>((resolve) => held.push(resolve));
    const description = descriptionIn(operation, result);
    journal.push(`response ${operation}${description === null ? "" : ` story-a.description=${JSON.stringify(description)}`}`);
    return result;
  };
  return {
    execute,
    journal,
    holdReads: () => { holding = true; },
    releaseReads: () => {
      holding = false;
      for (const release of held.splice(0)) release();
    },
    heldCount: () => held.length,
  };
}

function seed() {
  const http = fixture();
  http.tree("module-1", {
    rootIds: ["story-a", "story-b"],
    children: { "story-a": [], "story-b": [] },
    order: ["story-a", "story-b"],
  });
  http.workItems([
    workItem({ id: "story-a", key: "MEML-1", name: "Story A", description: ORIGINAL }),
    workItem({ id: "story-b", key: "MEML-2", name: "Story B", description: "Story B" }),
  ]);
  return http;
}

async function mountWithFeed() {
  const http = seed();
  const wire = instrument(http);
  const feed = statusFeedTransport();
  mountStudio({ http, selectedTaskId: "story-a", graphQlExecute: wire.execute });
  statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
  await waitFor(() => expect(feed.ready()).toBe(true));
  const details = screen.getByRole("region", { name: "Details" });
  expect(await within(details).findByText(ORIGINAL)).toBeVisible();
  wire.journal.length = 0;
  return { wire, feed, details };
}

const fact = (workItemId: string, payload: Record<string, unknown> = {}) =>
  workItemChangedFact(PROJECT, workItemId, payload);

async function saveDescription(details: HTMLElement, wire: ReturnType<typeof instrument>) {
  fireEvent.change(await within(details).findByLabelText("Story description"), {
    target: { value: SAVED },
  });
  fireEvent.click(within(details).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(wire.journal).toContain(
    `response UpdateWorkTrackerWorkItemDetails story-a.description=${JSON.stringify(SAVED)}`,
  ));
  expect(await within(details).findByText(SAVED)).toBeVisible();
}

/**
 * Scenario A — just-saved description. An agent fact for the selected Story
 * arrives; its per-item refetch is in flight while the user saves.
 */
async function justSavedThenStaleItemRead() {
  const { wire, feed, details } = await mountWithFeed();
  wire.holdReads();
  feed.send(fact("story-a", { occurredAt: "2026-09-05T10:00:00+00:00" }));
  await waitFor(() => expect(wire.heldCount()).toBe(1));

  fireEvent.click(within(details).getByTestId("issue-description"));
  await saveDescription(details, wire);

  // The mutation's own fact names the adopted server version: consumed, no refetch.
  const before = wire.journal.length;
  feed.send(fact("story-a", { occurredAt: SAVED_AT }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(wire.journal.slice(before)).toEqual([]);

  wire.releaseReads();
  return { wire, details };
}

/**
 * Scenario B — dirty editor. The editor holds a draft when a sibling's
 * membership fact arrives; the module-open refetch is in flight while the
 * user saves.
 */
async function dirtyEditorThenStaleModuleRead() {
  const { wire, feed, details } = await mountWithFeed();
  fireEvent.click(within(details).getByTestId("issue-description"));
  fireEvent.change(await within(details).findByLabelText("Story description"), {
    target: { value: "Dirty draft" },
  });

  wire.holdReads();
  feed.send(fact("story-b", { membershipChanged: true, occurredAt: "2026-09-05T10:00:01+00:00" }));
  await waitFor(() => expect(wire.heldCount()).toBeGreaterThan(0));
  // The refetch left the dirty draft alone; the editor is still open.
  expect(within(details).getByLabelText("Story description")).toHaveValue("Dirty draft");

  await saveDescription(details, wire);
  wire.releaseReads();
  return { wire, details };
}

beforeEach(() => {
  resetFactCursor();
});

afterEach(() => {
  statusStreamFeed.stop();
  statusStreamFeed.resetCursors("project-1");
  vi.restoreAllMocks();
});

describe("CODING-1524 reproduction — description rollback under live fact traffic", () => {
  it("[evidence A] a stale per-item read landing after Save leaves the saved description in place", async () => {
    const { wire, details } = await justSavedThenStaleItemRead();

    await waitFor(() => expect(wire.journal).toHaveLength(4));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(details).getByText(SAVED)).toBeVisible();
    expect(within(details).queryByText(ORIGINAL)).toBeNull();
    expect(wire.journal).toEqual([
      'request  WorkTrackerWorkItem {"id":"story-a"}',
      'request  UpdateWorkTrackerWorkItemDetails {"id":"story-a","description":"Saved description"}',
      'response UpdateWorkTrackerWorkItemDetails story-a.description="Saved description"',
      'response WorkTrackerWorkItem story-a.description="Original description"',
    ]);
  });

  it("[evidence B] a stale module-open read landing after Save leaves the saved description in place", async () => {
    const { wire, details } = await dirtyEditorThenStaleModuleRead();

    await waitFor(() => expect(wire.journal).toHaveLength(6));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(details).getByText(SAVED)).toBeVisible();
    expect(within(details).queryByText(ORIGINAL)).toBeNull();
    expect(wire.journal).toEqual([
      'request  WorkTrackerWorkItem {"id":"story-b"}',
      'request  WorkTrackerModuleOpen {"moduleId":"module-1"}',
      'request  UpdateWorkTrackerWorkItemDetails {"id":"story-a","description":"Saved description"}',
      'response UpdateWorkTrackerWorkItemDetails story-a.description="Saved description"',
      'response WorkTrackerWorkItem',
      'response WorkTrackerModuleOpen story-a.description="Original description"',
    ]);
  });

  it("[convergence A] a just-saved description survives a late per-item read", async () => {
    const { details } = await justSavedThenStaleItemRead();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(details).getByText(SAVED)).toBeVisible();
  });

  it("[convergence B] a description saved from a dirty editor survives a late module-open read", async () => {
    const { details } = await dirtyEditorThenStaleModuleRead();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(details).getByText(SAVED)).toBeVisible();
  });
});
