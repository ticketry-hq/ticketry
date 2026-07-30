import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTask,
  getConfig,
  getIssueTypes,
  getProjects,
  normalizeTask,
  postTaskStatus,
} from "../features/studio/lib/api";
import type { WorkItem } from "../shared/api/types";
import { useConfigStore } from "../features/studio/stores/configStore";
import { initializeBrowserRuntime, initializeStudioRuntime } from "../runtime";

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Studio idea capture API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useConfigStore.setState({ profiles: [], recentProfileIndex: null });
  });

  afterEach(() => {
    initializeBrowserRuntime();
  });

  it("uses the desktop runtime key for agent and WorkTracker requests without a profile", async () => {
    initializeStudioRuntime({
      platform: "desktop",
      capabilities: {
        statusFeed: true,
        websocketTerminal: true,
        nativeLifecycle: false,
        serviceSupervision: false,
        nativeTerminal: false,
        nativeFolderPicker: false,
      },
      pickFolder: async () => null,
      retryServices: async () => {},
      startup: () => ({
        endpoints: {
          agentApi: "http://127.0.0.1:8787/api",
          statusApi: "http://127.0.0.1:8787/api",
          statusWebSocket: "ws://127.0.0.1:8787/ws/status",
          terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
          workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
        },
        values: { workTrackerApiKey: "desktop-runtime-key" },
        serviceHealth: {
          state: "ready",
          service: "backend",
          message: null,
          logPointer: null,
        },
        initialNotices: [],
      }),
      subscribeServiceHealth: () => () => {},
      subscribeUserNotices: () => () => {},
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ profiles: [] }))
      .mockResolvedValueOnce(jsonResponse([]));

    await getConfig();
    await getProjects();

    const [agentUrl, agentInit] = fetchMock.mock.calls[0];
    expect(agentUrl).toBe("http://127.0.0.1:8787/api/config");
    expect(new Headers(agentInit.headers).get("x-api-key")).toBe("desktop-runtime-key");
    const [workTrackerUrl, workTrackerInit] = fetchMock.mock.calls[1];
    expect(workTrackerUrl).toBe("http://127.0.0.1:8787/api/work-tracker/projects");
    expect(new Headers(workTrackerInit.headers).get("x-api-key")).toBe(
      "desktop-runtime-key",
    );
  });

  it("lists project issue types and sends the explicit Story type on create", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "type-story", name: "Story", level: "task", is_default: false },
      ]),
    );

    await expect(getIssueTypes("project-1")).resolves.toEqual([
      { id: "type-story", name: "Story", level: "task", is_default: false },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/work-tracker/projects/project-1/issue-types",
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "story-1",
        name: "Captured idea",
        project_id: "project-1",
        sequence_id: 42,
        state: { id: "idea", name: "Idea", group: "backlog", color: null },
        assignees: [],
        labels: [],
        description_html: null,
        description_stripped: null,
        description: null,
        parent_id: "module-1",
        sub_issues_count: 0,
      }),
    );

    await createTask("project-1", "Captured idea", "module-1", "type-story");

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/work-tracker/projects/project-1/work-items");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Captured idea",
      parent_id: "module-1",
      issue_type_id: "type-story",
    });
  });

  it("preserves task key, rank, and type while normalizing an absent type to null", () => {
    const baseTask = {
      id: "task-1",
      key: "CODIN-1",
      name: "Typed task",
      project_id: "project-1",
      sequence_id: 1,
      state: { id: "todo", name: "Todo", group: "backlog", color: null },
      assignees: [],
      labels: [],
      description_html: null,
      description_stripped: null,
      description: null,
      parent_id: "module-1",
      sub_issues_count: 0,
      blocked_by_ids: [],
      blocks_ids: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    } satisfies WorkItem;
    const customType = {
      id: "type-investigation",
      name: "Investigation",
      level: "task",
    };

    const normalized = normalizeTask({
      ...baseTask,
      rank: "rank-7",
      issue_type: customType,
    });
    expect(normalized.key).toBe("CODIN-1");
    expect(normalized.rank).toBe("rank-7");
    expect(normalized.issue_type).toEqual(customType);
    expect(normalizeTask(baseTask).issue_type).toBeNull();
  });

  it("stamps human origin on the Studio status-change request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "task-1",
      name: "Story",
      project_id: "project-1",
      sequence_id: 1,
      state: { id: "review", name: "Review", group: "started", color: null },
      assignees: [],
      labels: [],
      description_html: null,
      description_stripped: null,
      description: null,
      parent_id: "module-1",
      sub_issues_count: 0,
    }));

    await postTaskStatus("project-1", "task-1", "review", true);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      state_id: "review",
      origin: "human",
      force_if_completed: true,
    });
  });
});
