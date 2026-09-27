import type { ReactNode } from "react";
/**
 * CODING-1527 — an agent or another client changes the selected Story's
 * description. The fact refetches the authoritative row: a clean editor
 * follows it, and a dirty draft stays put behind a non-blocking notice
 * offering to keep the draft or load the server version. Autosave waits for
 * that choice. Nothing merges.
 */
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { fixture, mountStudio, workItem } from "./seam";
import {
  resetFactCursor,
  statusFeedTransport,
  workItemChangedFact,
} from "./statusStreamFeedFixture";

vi.mock("../features/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
    toolbarActions,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
    toolbarActions?: ReactNode;
  }) => (
    <>
      <textarea
        aria-label="Story description"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
      {toolbarActions}
    </>
  ),
}));

configure({ asyncUtilTimeout: 5000 });

const PROJECT = "project-1";
const ORIGINAL = "Original description";
const AGENT_WROTE = "Agent rewrote this description";
const DRAFT = "My in-progress draft";
const NOTICE = /This description changed on the server/;

async function mountWithFeed() {
  const http = fixture();
  http.tree("module-1", { rootIds: ["story-a"], children: { "story-a": [] }, order: ["story-a"] });
  http.workItems([workItem({ id: "story-a", key: "MEML-1", name: "Story A", description: ORIGINAL })]);
  const updates: Array<Record<string, unknown>> = [];
  const execute: typeof http.executeGraphQl = async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerWorkItemDetails") {
      updates.push(variables as Record<string, unknown>);
    }
    return http.executeGraphQl(document, variables);
  };
  const feed = statusFeedTransport();
  mountStudio({ http, selectedTaskId: "story-a", graphQlExecute: execute });
  statusStreamFeed.start(PROJECT, { createProxy: feed.createProxy });
  await waitFor(() => expect(feed.ready()).toBe(true));
  const details = screen.getByRole("region", { name: "Details" });
  expect(await within(details).findByLabelText("Story description")).toHaveValue(ORIGINAL);

  /** Another client writes the row on the server, then its fact arrives. */
  const externalWrite = (description: string) => {
    http.revise("story-a", { description });
    feed.send(workItemChangedFact(PROJECT, "story-a", { occurredAt: "2026-09-05T10:00:05+00:00" }));
  };
  return { http, details, updates, externalWrite };
}

async function openDirtyEditor(details: HTMLElement) {
  const editor = await within(details).findByLabelText("Story description");
  fireEvent.change(editor, { target: { value: DRAFT } });
  return editor;
}

beforeEach(() => {
  resetFactCursor();
});

afterEach(() => {
  statusStreamFeed.stop();
  statusStreamFeed.resetCursors(PROJECT);
  vi.restoreAllMocks();
});

describe("overhaul acceptance — external description change while editing", () => {
  it("[CODING-1527 a] a fact-driven external change repaints a clean editor without reload", async () => {
    const { details, updates, externalWrite } = await mountWithFeed();
    externalWrite(AGENT_WROTE);
    await waitFor(() =>
      expect(within(details).getByLabelText("Story description")).toHaveValue(AGENT_WROTE),
    );
    expect(within(details).queryByRole("status")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(updates).toHaveLength(0);
  });

  it("[CODING-1527 b] an open editor keeps its draft behind a notice; keep my draft preserves it", async () => {
    const { http, details, updates, externalWrite } = await mountWithFeed();
    const editor = await openDirtyEditor(details);

    externalWrite(AGENT_WROTE);
    const notice = await within(details).findByRole("status");
    expect(notice).toHaveTextContent(NOTICE);
    expect(within(details).getByLabelText("Story description")).toHaveValue(DRAFT);

    // Autosave holds while the choice is pending.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(updates).toHaveLength(0);

    fireEvent.click(within(notice).getByRole("button", { name: "Keep my draft" }));
    await waitFor(() => expect(within(details).queryByRole("status")).toBeNull());
    expect(editor).toHaveValue(DRAFT);

    await http.expectPatch("story-a", { description: DRAFT });
    expect(updates).toHaveLength(1);
  });

  it("[CODING-1527 c] load the server version replaces the draft with the authoritative description", async () => {
    const { details, updates, externalWrite } = await mountWithFeed();
    await openDirtyEditor(details);

    externalWrite(AGENT_WROTE);
    const notice = await within(details).findByRole("status");
    fireEvent.click(within(notice).getByRole("button", { name: "Load the server version" }));

    await waitFor(() =>
      expect(within(details).getByLabelText("Story description")).toHaveValue(AGENT_WROTE),
    );
    expect(within(details).queryByRole("status")).toBeNull();

    // The loaded version is the new baseline: autosave has nothing to write.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(updates).toHaveLength(0);
  });

  it("[CODING-1527 d] the editor's own save never raises the notice", async () => {
    const { http, details, externalWrite } = await mountWithFeed();
    const editor = await openDirtyEditor(details);
    fireEvent.change(editor, { target: { value: `${DRAFT}  ` } });
    fireEvent.blur(editor, { relatedTarget: document.body });
    await http.expectPatch("story-a", { description: DRAFT });
    // The mutation's fact names the version the editor already adopted.
    externalWrite(DRAFT);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(within(details).queryByRole("status")).toBeNull();
    expect(within(details).getByLabelText("Story description")).toHaveValue(`${DRAFT}  `);
  });
});
