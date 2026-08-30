import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateCatalog } from "../features/workflows/StateCatalog";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { setStatesSorted } from "../features/projects";
import {
  getWorkflowIssueTypesSnapshot,
  getWorkflowStatesSnapshot,
  setWorkflowIssueTypes,
  setWorkflowStateCounts,
} from "../features/workflows/queries";

const fetchMock = vi.fn();
const workflowReads = vi.hoisted(() => ({
  readWorkflowSettings: vi.fn(),
}));

vi.mock("../features/workflows/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/workflows/queries/readTransport")),
  readWorkflowSettings: workflowReads.readWorkflowSettings,
}));

const states = [
  { id: "todo", name: "Todo", group: "unstarted", color: null, sort_order: 0 },
  { id: "build", name: "Build", group: "started", color: null, sort_order: 1 },
  { id: "review", name: "Review", group: "started", color: null, sort_order: 2 },
  { id: "done", name: "Done", group: "completed", color: null, sort_order: 3 },
];

const workflow = {
  issue_type_id: "story",
  start_state_id: "todo",
  workflow_revision: 4,
  transitions: [
    { from_state_id: "todo", to_state_id: "review", agent_allowed: true },
    { from_state_id: "review", to_state_id: "done", agent_allowed: true },
  ],
  launch_bindings: [],
  warnings: [],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("workflow settings acceptance", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/work-tracker/issue-types/story")) {
          return jsonResponse({
            id: "story",
            name: "Story",
            level: "task",
            sort_order: 0,
            start_state: "todo",
            workflow_revision: 4,
          });
        }
        if (url.endsWith("/work-tracker/projects/project-1/states")) {
          return jsonResponse(states);
        }
        if (url.endsWith("/work-tracker/issue-types/story/transitions")) {
          return jsonResponse(workflow.transitions.map((transition, index) => ({
            id: index + 1,
            issue_type: "story",
            from_state: transition.from_state_id,
            to_state: transition.to_state_id,
            agent_allowed: transition.agent_allowed,
          })));
        }
        if (url.endsWith("/work-tracker/projects/project-1/launch-bindings")) {
          return jsonResponse([]);
        }
        if (
          url.endsWith("/work-tracker/providers")
          || url.endsWith("/work-tracker/models")
          || url.endsWith("/work-tracker/reasoning-levels")
        ) {
          return jsonResponse([]);
        }
        if (url.endsWith("/settings/provider-catalog")) {
          return jsonResponse({ value: { global_default: null } });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    workflowReads.readWorkflowSettings.mockReset().mockResolvedValue(workflow);
    setStatesSorted("project-1", states);
    setWorkflowIssueTypes("project-1", [
      { id: "story", name: "Story", level: "task", color: null, sort_order: 0 },
    ]);
    setWorkflowStateCounts("project-1", { review: 2 });
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      issueTypes: [
        { id: "story", name: "Story", level: "task", color: null, sort_order: 0 },
      ],
      states,
      stateWorkItemCounts: { review: 2 },
      providerCapabilities: [],
      selectedTypeId: "story",
      workflows: { story: workflow },
      stagedStateIds: {},
      loading: false,
      action: null,
      notice: null,
      error: null,
      controlErrors: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-19] derives state-delete blockers without deleted impact or composite workflow reads", async () => {
    render(<StateCatalog />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Review" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Review?" });
    expect(dialog).toHaveTextContent("2 work items are in this state");
    expect(dialog).toHaveTextContent("Empty the state first");
    expect(dialog).toHaveTextContent("referenced by workflow configuration");
    expect(screen.queryByRole("button", { name: "Delete state" })).toBeNull();

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(workflowReads.readWorkflowSettings).toHaveBeenCalledWith(
      "project-1",
      "story",
      "cache-first",
    );
    expect(urls.some((url) => url.includes("/states/review/impact"))).toBe(false);
    expect(urls.some((url) => url.endsWith("/workflow-settings"))).toBe(false);
  });

  it("retains the visible state catalog while workflow policy starts loading", async () => {
    useWorkflowEditorStore.setState(useWorkflowEditorStore.getInitialState(), true);
    setStatesSorted("project-1", states);
    setWorkflowIssueTypes("project-1", [
      { id: "story", name: "Story", level: "task", color: null, sort_order: 0 },
    ]);

    const loading = useWorkflowEditorStore.getState().load("project-1");

    expect(getWorkflowStatesSnapshot("project-1").map((state) => state.name))
      .toEqual(["Todo", "Build", "Review", "Done"]);
    expect(getWorkflowIssueTypesSnapshot("project-1").map((type) => type.name))
      .toEqual(["Story"]);

    await loading;
  });
});
