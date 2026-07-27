import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addIssueTypeWorkflowTransition,
  getIssueTypeWorkflowSettings,
  removeIssueTypeWorkflowTransition,
  setIssueTypeWorkflowAutoStart,
  setIssueTypeWorkflowSubtreeRun,
  setIssueTypeWorkflowStartState,
  setIssueTypeWorkflowTransitionPermission,
  upsertIssueTypeWorkflowLaunchBinding,
} from "../features/studio/workflowApi";
import { useConfigStore } from "../features/studio/stores/configStore";

const fetchMock = vi.fn();

function response(): Response {
  return new Response(JSON.stringify({
    issue_type_id: "story",
    start_state_id: "todo",
    workflow_revision: 8,
    transitions: [],
    launch_bindings: [],
    warnings: [],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("scoped workflow-settings API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    vi.unstubAllEnvs();
    useConfigStore.setState({ profiles: [], recentProfileIndex: null });
  });

  it("routes reads through the runtime endpoint", async () => {
    vi.stubEnv("VITE_WT_API_BASE", "https://tracker.example.test/work-tracker");

    await getIssueTypeWorkflowSettings("story");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://tracker.example.test/work-tracker/issue-types/story/workflow-settings",
    );
  });

  it("sends transition operations with their current workflow revision", async () => {
    await addIssueTypeWorkflowTransition("story", {
      from_state_id: "todo",
      to_state_id: "done",
      agent_allowed: true,
      workflow_revision: 7,
    });
    await setIssueTypeWorkflowTransitionPermission(
      "story",
      "todo",
      "done",
      false,
      8,
    );
    await removeIssueTypeWorkflowTransition("story", "todo", "done", 9);

    expect(fetchMock.mock.calls.map(([url, init]) => [
      url,
      init.method,
      JSON.parse(init.body),
    ])).toEqual([
      [
        "/api/work-tracker/issue-types/story/workflow-settings/transitions",
        "POST",
        {
          from_state_id: "todo",
          to_state_id: "done",
          agent_allowed: true,
          workflow_revision: 7,
        },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/transitions/todo/done",
        "PATCH",
        { agent_allowed: false, workflow_revision: 8 },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/transitions/todo/done",
        "DELETE",
        { workflow_revision: 9 },
      ],
    ]);
  });

  it("sends start-state and entry-behavior edits as scoped applies", async () => {
    await setIssueTypeWorkflowStartState("story", "review", 7);
    await upsertIssueTypeWorkflowLaunchBinding("story", "review", {
      prompt: "Review the work.",
      agent: "claude",
      model: "sonnet",
      reasoning: "high",
    }, 8);
    await setIssueTypeWorkflowAutoStart("story", "review", true, 9);
    await setIssueTypeWorkflowSubtreeRun("story", "review", true, 10);

    expect(fetchMock.mock.calls.map(([url, init]) => [
      url,
      init.method,
      JSON.parse(init.body),
    ])).toEqual([
      [
        "/api/work-tracker/issue-types/story/workflow-settings/start-state",
        "PUT",
        { state_id: "review", workflow_revision: 7 },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/launch-bindings/review",
        "PUT",
        {
          prompt: "Review the work.",
          agent: "claude",
          model: "sonnet",
          reasoning: "high",
          workflow_revision: 8,
        },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/launch-bindings/review/auto-start",
        "PATCH",
        { auto_start: true, workflow_revision: 9 },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/launch-bindings/review/subtree-run",
        "PUT",
        { enabled: true, workflow_revision: 10 },
      ],
    ]);
  });
});
