import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  documentOperationName,
  type TypedDocumentNode,
} from "../graphql-foundation/typedDocument";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { seedModuleLinks } from "../features/module-links";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem, type StudioFixture } from "./seam";

// CODING-2248: a module without a folder still captures ideas. Recording a
// Story never asks for a folder, trust, or an agent launch.

const readyState = { id: "ready-state", name: "Ready", group: "backlog", color: null, sort_order: 1 };
const storyType = {
  id: "story-type",
  name: "Story",
  level: "task" as const,
  color: null,
  sort_order: 1,
  start_state: readyState.id,
};

interface CaptureHarness {
  http: StudioFixture;
  creates: Array<Record<string, unknown>>;
  failNextCreate: () => void;
  holdCreates: () => () => void;
}

function folderlessModule(): CaptureHarness {
  const http = fixture();
  const seedId = "11111111111111111111111111111111";
  // A Story type must be known to the fixture; an existing Story supplies it.
  http.workItems([workItem({ id: seedId, name: "Existing Story", state: readyState, issue_type: storyType })]);
  http.tree("module-1", { rootIds: [seedId], children: { [seedId]: [] }, order: [seedId] });
  const creates: Array<Record<string, unknown>> = [];
  let failNext = false;
  let hold: Promise<void> | null = null;
  const execute = async <TResult, TVariables>(
    document: TypedDocumentNode<TResult, TVariables>,
    variables: TVariables,
  ): Promise<TResult> => {
    if (documentOperationName(document) !== "CreateWorkTrackerWorkItem") {
      return http.executeGraphQl(document, variables);
    }
    creates.push(variables as Record<string, unknown>);
    if (hold) await hold;
    if (failNext) {
      failNext = false;
      throw new Error("database is locked");
    }
    const id = String(creates.length + 1).repeat(32).slice(0, 32);
    http.workItems([workItem({
      id,
      name: "Plan a simple welcome page",
      key: `MEML-${creates.length + 1}`,
      sequence_id: creates.length + 1,
      rank: "A",
      state: readyState,
      issue_type: storyType,
    })]);
    http.tree("module-1", { rootIds: [id, seedId], children: { [id]: [], [seedId]: [] }, order: [id, seedId] });
    const lookup = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id: compactWorktrackerId(id) });
    return { create_work_item: lookup.work_item.nodes[0] } as TResult;
  };
  mountStudio({ http, graphQlExecute: execute });
  return {
    http,
    creates,
    failNextCreate: () => { failNext = true; },
    holdCreates: () => {
      let release = (): void => {};
      hold = new Promise<void>((resolve) => { release = resolve; });
      return () => { hold = null; release(); };
    },
  };
}

async function ideaEntry(): Promise<HTMLElement> {
  const stories = await screen.findByRole("region", { name: "Stories" });
  await within(stories).findByText("Existing Story");
  return within(stories).getByRole("textbox", { name: "Capture an idea" });
}

function createdInput(create: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(create)) as Record<string, unknown>;
}

describe("overhaul acceptance — idea capture without a module folder", () => {
  beforeEach(() => {
    seedModuleLinks([]);
    useModalStore.setState({ modalStack: [] });
  });

  it("[overhaul-403] Enter in Capture an idea creates exactly one Story in a folderless module without folder setup", async () => {
    const { creates } = folderlessModule();
    const input = await ideaEntry();

    fireEvent.change(input, { target: { value: "Plan a simple welcome page" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(input).toHaveValue(""));
    expect(creates).toHaveLength(1);
    expect(JSON.stringify(createdInput(creates[0]))).toContain("module-1");
    expect(JSON.stringify(createdInput(creates[0]))).toContain("story-type");
    const stories = screen.getByRole("region", { name: "Stories" });
    expect(await within(stories).findByText("Plan a simple welcome page")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Trust module folder?" })).not.toBeInTheDocument();
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  });

  it("[overhaul-404] keeps the draft on failure, retries once, ignores repeated Enter while pending, and creates nothing from blank input", async () => {
    const { creates, failNextCreate, holdCreates } = folderlessModule();
    const input = await ideaEntry();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(creates).toHaveLength(0);

    failNextCreate();
    fireEvent.change(input, { target: { value: "Plan a simple welcome page" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useClientStore.getState().toasts.at(-1)?.message)
      .toMatch(/Story could not be created: .*database is locked/));
    expect(input).toHaveValue("Plan a simple welcome page");
    expect(creates).toHaveLength(1);

    const release = holdCreates();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(creates).toHaveLength(2));
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    release();

    await waitFor(() => expect(input).toHaveValue(""));
    expect(creates).toHaveLength(2);
    const stories = screen.getByRole("region", { name: "Stories" });
    expect(await within(stories).findByText("Plan a simple welcome page")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).not.toBeInTheDocument();
  });
});
