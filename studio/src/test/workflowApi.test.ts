import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addIssueTypeWorkflowTransition,
  deleteState,
  getIssueTypeWorkflowSettings,
  removeIssueTypeWorkflowTransition,
  setIssueTypeWorkflowAutoStart,
  setIssueTypeWorkflowStartState,
  setIssueTypeWorkflowSubtreeRun,
  setIssueTypeWorkflowTransitionPermission,
  upsertIssueTypeWorkflowLaunchBinding,
} from "../shared/api/client";
import { seedConfig } from "../features/studio/stores/configStore";

const fetchMock = vi.fn();

function jsonResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function canonicalReadResponse(url: string): Response {
  if (url.endsWith("/work-tracker/issue-types/story")) {
    return jsonResponse({
      id: "story",
      name: "Story",
      level: "task",
      sort_order: 0,
      start_state: "todo",
      workflow_revision: 8,
    });
  }
  if (url.endsWith("/work-tracker/projects/project/states")) {
    return jsonResponse([
      { id: "todo", name: "Todo", group: "unstarted", sort_order: 0 },
      { id: "done", name: "Done", group: "completed", sort_order: 1 },
    ]);
  }
  if (url.endsWith("/work-tracker/issue-types/story/transitions")) {
    return jsonResponse([{
      id: 1,
      issue_type: "story",
      from_state: "todo",
      to_state: "done",
      agent_allowed: true,
    }]);
  }
  if (url.endsWith("/work-tracker/projects/project/launch-bindings")) {
    return jsonResponse([{
      id: 2,
      issue_type: "story",
      state: "todo",
      prompt: "Implement it.",
      required_skills: ["to-spec"],
      model: "model-luna",
      reasoning: "reason-medium",
      auto_start: true,
      subtree_run_enabled: true,
    }]);
  }
  if (url.endsWith("/work-tracker/providers")) {
    return jsonResponse([{
      id: "provider-codex",
      slug: "codex",
      activated: true,
      supports_unattended: true,
    }]);
  }
  if (url.endsWith("/work-tracker/models")) {
    return jsonResponse([{
      id: "model-luna",
      provider: "provider-codex",
      name: "gpt-5.6-luna",
      permitted_reasoning_levels: ["reason-medium"],
    }]);
  }
  if (url.endsWith("/work-tracker/reasoning-levels")) {
    return jsonResponse([{ id: "reason-medium", name: "medium" }]);
  }
  if (url.endsWith("/settings/provider-catalog")) {
    return jsonResponse({ value: { global_default: null } });
  }
  throw new Error(`Unexpected request: ${url}`);
}

describe("scoped workflow settings API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.unstubAllEnvs();
    seedConfig({ profiles: [], recentProfileIndex: null });
  });

  it("assembles a workflow from canonical issue-type, transition, binding, and catalog reads", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      canonicalReadResponse(String(input)));

    const workflow = await getIssueTypeWorkflowSettings("project", "story");

    expect(workflow).toMatchObject({
      issue_type_id: "story",
      start_state_id: "todo",
      workflow_revision: 8,
      transitions: [{
        from_state_id: "todo",
        to_state_id: "done",
        agent_allowed: true,
      }],
      launch_bindings: [{
        state_id: "todo",
        prompt: "Implement it.",
        required_skills: ["to-spec"],
        agent: "codex",
        model: "gpt-5.6-luna",
        reasoning: "medium",
        auto_start: true,
        subtree_run_enabled: true,
      }],
      warnings: [],
    });
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toEqual(expect.arrayContaining([
      "/api/work-tracker/issue-types/story",
      "/api/work-tracker/issue-types/story/transitions",
      "/api/work-tracker/projects/project/launch-bindings",
      "/api/work-tracker/providers",
      "/api/work-tracker/models",
      "/api/work-tracker/reasoning-levels",
    ]));
    expect(urls.some((url) => url.endsWith("/workflow-settings"))).toBe(false);
  });

  it("writes transitions and the start state through canonical row endpoints", async () => {
    fetchMock.mockImplementation(async () => jsonResponse());

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
    await setIssueTypeWorkflowStartState("story", "review", 10);

    expect(fetchMock.mock.calls.map(([url, init]) => [
      String(url),
      init.method,
      JSON.parse(String(init.body)),
    ])).toEqual([
      [
        "/api/work-tracker/issue-types/story/transitions",
        "POST",
        {
          from_state: "todo",
          to_state: "done",
          agent_allowed: true,
          workflow_revision: 7,
        },
      ],
      [
        "/api/work-tracker/issue-types/story/transitions/todo/done",
        "PATCH",
        { agent_allowed: false, workflow_revision: 8 },
      ],
      [
        "/api/work-tracker/issue-types/story/transitions/todo/done",
        "DELETE",
        { workflow_revision: 9 },
      ],
      [
        "/api/work-tracker/issue-types/story",
        "PATCH",
        { start_state: "review", workflow_revision: 10 },
      ],
    ]);
  });

  it("resolves launch names through the catalog and writes flags on the binding row", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/work-tracker/providers")) {
        return canonicalReadResponse(url);
      }
      if (url.endsWith("/work-tracker/models")) {
        return canonicalReadResponse(url);
      }
      if (url.endsWith("/work-tracker/reasoning-levels")) {
        return canonicalReadResponse(url);
      }
      return jsonResponse();
    });

    await upsertIssueTypeWorkflowLaunchBinding("story", "review", {
      prompt: "Review the work.",
      agent: "codex",
      model: "gpt-5.6-luna",
      reasoning: "medium",
    }, 8);
    await setIssueTypeWorkflowAutoStart("story", "review", true, 9);
    await setIssueTypeWorkflowSubtreeRun("story", "review", true, 10);

    const writes = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PUT")
      .map(([url, init]) => [
        String(url),
        JSON.parse(String(init.body)),
      ]);
    expect(writes).toEqual([
      [
        "/api/work-tracker/issue-types/story/workflow-settings/launch-bindings/review",
        {
          prompt: "Review the work.",
          model: "model-luna",
          reasoning: "reason-medium",
          workflow_revision: 8,
        },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/launch-bindings/review",
        { auto_start: true, workflow_revision: 9 },
      ],
      [
        "/api/work-tracker/issue-types/story/workflow-settings/launch-bindings/review",
        { subtree_run_enabled: true, workflow_revision: 10 },
      ],
    ]);
  });

  it("deletes a state directly without calling the removed impact endpoint", async () => {
    fetchMock.mockImplementation(async () => jsonResponse());

    await deleteState("review");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0].slice(0, 2)).toMatchObject([
      "/api/work-tracker/states/review",
      { method: "DELETE" },
    ]);
  });
});
