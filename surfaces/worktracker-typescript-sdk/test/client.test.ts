import { describe, expect, it, vi } from "vitest";
import {
  WorkTrackerApiError,
  createAgentStatusClient,
  createWorkTrackerClient,
} from "../src/index.js";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createWorkTrackerClient", () => {
  it("normalizes the base URL and injects x-api-key", async () => {
    const fetch = vi.fn().mockResolvedValue(response([]));
    const client = createWorkTrackerClient({
      baseUrl: "https://wt.example/api/work-tracker/",
      apiKey: "secret",
      fetch,
    });

    await client.projects.listProjects();

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://wt.example/api/work-tracker/projects");
    expect(new Headers(init.headers).get("x-api-key")).toBe("secret");
  });

  it("encodes query parameters and JSON bodies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(
        response({
          id: "w1",
          name: "Task",
          project_id: "p1",
          key: "CODIN-1",
          created_at: "2026-06-24T00:00:00Z",
          updated_at: "2026-06-24T00:00:00Z",
        }),
      );
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });

    await client.workItems.listWorkItems({
      project: "p 1",
      state: "s/1",
    });
    await client.workItems.updateWorkItem({
      issueId: "w1",
      patchedWorkItemPatch: { name: "Renamed" },
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "/api/work-tracker/work-items?project=p%201&state=s%2F1",
    );
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({
      name: "Renamed",
    });
  });

  it("exposes the scoped workflow contract", async () => {
    const workflow = {
      issue_type_id: "type-1",
      start_state_id: "todo",
      workflow_revision: 4,
      transitions: [],
      launch_bindings: [],
      warnings: [],
    };
    const fetch = vi.fn().mockResolvedValue(response(workflow));
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });

    await client.workflows.createIssueTypeTransition({
      typeId: "type/1",
      issueTypeTransition: {
        from_state: "todo",
        to_state: "done",
        agent_allowed: true,
        workflow_revision: 3,
      },
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "/api/work-tracker/issue-types/type%2F1/transitions",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({
      from_state: "todo",
      to_state: "done",
      agent_allowed: true,
      workflow_revision: 3,
    });
  });

  it("uses FormData for attachment upload", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        id: "a1",
        filename: "note.txt",
        url: "/media/note.txt",
      }),
    );
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });

    await client.attachments.uploadAttachment({
      issueId: "w1",
      file: new Blob(["hello"], { type: "text/plain" }),
      name: "note.txt",
    });

    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("content-type")).toBe(false);
  });

  it("exposes workspace onboarding before project selection", async () => {
    const workspace = {
      id: "w1", name: "MEML", slug: "meml", onboarding_required: true,
    };
    const fetch = vi.fn().mockResolvedValue(response(workspace));
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });

    await expect(client.workspace.retrieveWorkspace()).resolves.toEqual(workspace);
    expect(fetch.mock.calls[0][0]).toBe("/api/work-tracker/workspace");
  });

  it("resolves empty 204 responses as undefined", async () => {
    const fetch = vi.fn().mockResolvedValue(response(undefined, 204));
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });

    await expect(
      client.workItems.deleteWorkItem({ issueId: "w1" }),
    ).resolves.toBeUndefined();
  });

  it("maps message and validation errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ detail: "nope" }, 409))
      .mockResolvedValueOnce(
        response(
          { detail: [{ type: "missing", loc: ["body", "name"], msg: "Required" }] },
          422,
        ),
      );
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });

    await expect(client.projects.listProjects()).rejects.toMatchObject({
      name: "WorkTrackerApiError",
      status: 409,
      message: "nope",
    });
    try {
      await client.projects.listProjects();
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkTrackerApiError);
      expect((error as WorkTrackerApiError).validationDetails?.[0].msg).toBe(
        "Required",
      );
    }
  });

  it("passes AbortSignal and preserves the native abort error", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return response([]);
    });
    const client = createWorkTrackerClient({ baseUrl: "/api/work-tracker", fetch });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.projects.listProjects({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("createAgentStatusClient", () => {
  it("launches with the current-state default binding and an empty payload", async () => {
    const launched = {
      target_id: "task/1",
      agent: "codex",
      agent_run_id: "run-1",
    };
    const fetch = vi.fn().mockResolvedValue(response(launched, 201));
    const client = createAgentStatusClient({ baseUrl: "/api/", fetch });

    await expect(client.launchAgent({ issueId: "task/1" }))
      .resolves.toEqual(launched);
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/work-items/task%2F1/launch-agent",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
    });
    expect(new Headers(fetch.mock.calls[0][1].headers).get("content-type"))
      .toBe("application/json");
  });

  it("returns the typed project snapshot and supports task scope", async () => {
    const snapshot = {
      scope: { project_id: "p1", task_id: "t/1" },
      runs: [{
        agent_run_id: "r1",
        task_id: "t/1",
        module_id: "m1",
        state: "working" as const,
        updated_at: "2026-07-12T15:00:00Z",
      }],
      automation_attempts: [],
      at: "2026-07-12T15:01:00Z",
    };
    const fetch = vi.fn().mockResolvedValue(response(snapshot));
    const client = createAgentStatusClient({
      baseUrl: "/api/",
      apiKey: "secret",
      fetch,
    });

    await expect(client.getAgentStatus({ projectId: "p1", taskId: "t/1" }))
      .resolves.toEqual(snapshot);
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/runs/agent-status?project_id=p1&task_id=t%2F1",
    );
    expect(new Headers(fetch.mock.calls[0][1].headers).get("x-api-key"))
      .toBe("secret");
  });

  it("retries one automation attempt through the typed status client", async () => {
    const retried = {
      attempt_id: "retry-1",
      root_attempt_id: "attempt-1",
      retry_of_attempt_id: "attempt-1",
      work_item_id: "task-1",
      status: "succeeded" as const,
      error: null,
      agent_run_id: "run-1",
      updated_at: "2026-07-16T15:01:00Z",
    };
    const fetch = vi.fn().mockResolvedValue(response(retried));
    const client = createAgentStatusClient({ baseUrl: "/api/", fetch });

    await expect(client.retryAutomationAttempt({ attemptId: "attempt/1" }))
      .resolves.toEqual(retried);
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/automation-attempts/attempt%2F1/retry",
    );
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });
});
