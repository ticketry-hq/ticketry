import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  agentApiBase,
  apiBase,
  createIssueType,
  createModule,
  createState,
  createWorkItem,
  acknowledgeOnboarding,
  deleteIssueType,
  deleteState,
  deleteWorkItem,
  listIssueTypes,
  listModules,
  listProjectWorkItems,
  listProjects,
  getWorkspace,
  patchIssueType,
  patchState,
  patchWorkItem,
  reorderIssueTypes,
  reorderStates,
} from "../shared/api/client";
import { terminateTerminal } from "../features/agents/api/agentApi";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("api client", () => {
  it("falls back to /api/work-tracker when no base env is set", () => {
    expect(apiBase()).toBe("/api/work-tracker");
  });

  it("resolves the base URL from VITE_WT_API_BASE", () => {
    vi.stubEnv("VITE_WT_API_BASE", "https://wt.example.com/api");
    expect(apiBase()).toBe("https://wt.example.com/api");
  });

  it("uses the agent-runtime API root for status and retry traffic", () => {
    expect(agentApiBase()).toBe("/api");
    vi.stubEnv("VITE_AGENT_API_BASE", "https://agents.example.com/api");
    expect(agentApiBase()).toBe("https://agents.example.com/api");
  });

  it("terminates a run on the canonical terminal collection route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      agent_run_id: "run/1",
      terminated: true,
    }));

    await terminateTerminal("run/1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/terminals?agent_run_id=run%2F1");
    expect(init.method).toBe("DELETE");
  });

  it("sends x-api-key on every request and hits the projects path", async () => {
    vi.stubEnv("VITE_WT_API_KEY", "secret-token");
    fetchMock.mockResolvedValue(jsonResponse([{ id: "p1", name: "Studio", slug: "CODIN" }]));

    const projects = await listProjects();

    expect(projects).toEqual([{ id: "p1", name: "Studio", slug: "CODIN" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/projects");
    expect(new Headers(init.headers).get("x-api-key")).toBe("secret-token");
  });

  it("omits x-api-key when the key env is empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listProjects();
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).has("x-api-key")).toBe(false);
  });

  it("reads and acknowledges onboarding before project selection", async () => {
    const workspace = {
      id: "w1", name: "MEML", slug: "meml", onboarding_required: true,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(workspace));
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...workspace, onboarding_required: false,
    }));

    await expect(getWorkspace()).resolves.toEqual(workspace);
    await expect(acknowledgeOnboarding()).resolves.toMatchObject({
      onboarding_required: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/work-tracker/workspace");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/work-tracker/workspace/onboarding/acknowledge",
    );
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("builds the modules path with the project id", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listModules("proj-123");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/work-tracker/projects/proj-123/modules");
  });

  it("POSTs an explicit type when creating a module", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "module-1" }));
    await createModule("proj-123", "General", "type-module");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/projects/proj-123/modules");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "General",
      issue_type_id: "type-module",
    });
  });

  it("throws a typed ApiError with status + body on non-2xx", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 401));
    await expect(listProjects()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      body: { detail: "nope" },
    });
    await expect(listProjects()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("S2 fetchers", () => {
  it("builds the work-items list path with a state filter", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listProjectWorkItems("p1", { state: "s1" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/work-tracker/projects/p1/work-items?state=s1",
    );
  });

  it("omits the query string when no filters are set", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listProjectWorkItems("p1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/work-tracker/projects/p1/work-items");
  });

  it("forwards PathFind inclusion only when explicitly requested", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listProjectWorkItems("p1", { includePathfind: true });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/work-tracker/projects/p1/work-items?include_pathfind=true",
    );
  });

  it("POSTs a create body to the project work-items path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "w1" }));
    await createWorkItem("p1", {
      name: "Story",
      parent_id: "m1",
      issue_type_id: "type-story",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/projects/p1/work-items");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Story",
      parent_id: "m1",
      issue_type_id: "type-story",
    });
  });

  it("PATCHes a work item by its UUID id with only the changed fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "w1" }));
    await patchWorkItem("w1", { name: "Renamed" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/work-items/w1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Renamed" });
  });

  it("stamps human origin on state-change patches", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "w1" }));
    await patchWorkItem("w1", { state_id: "review" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      state_id: "review",
      origin: "human",
    });
  });

  it("DELETEs a work item and resolves on an empty 204 body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
    await expect(deleteWorkItem("w1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/work-items/w1");
    expect(init.method).toBe("DELETE");
  });
});

describe("S6 config fetchers", () => {
  it("lists issue types under the project", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await listIssueTypes("p1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/work-tracker/projects/p1/issue-types",
    );
  });

  it("POSTs a new issue type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "t1" }));
    await createIssueType("p1", { name: "Bug", level: "task" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/projects/p1/issue-types");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Bug", level: "task" });
  });

  it("PATCHes an issue type by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "t1" }));
    await patchIssueType("t1", { name: "Bug" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/issue-types/t1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Bug" });
  });

  it("DELETEs an issue type with a reassign_to query when given", async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
    await deleteIssueType("t1", "t2");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/work-tracker/issue-types/t1?reassign_to=t2",
    );
  });

  it("DELETEs an issue type without a query when no reassign target", async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
    await deleteIssueType("t1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/work-tracker/issue-types/t1");
  });

  it("POSTs the full ordered id set to the issue-type reorder route", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await reorderIssueTypes("p1", ["a", "b"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/work-tracker/projects/p1/issue-types/reorder");
    expect(JSON.parse(init.body)).toEqual({ ordered_ids: ["a", "b"] });
  });

  it("POSTs a new state, PATCHes / DELETEs / reorders by their paths", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "s1" }));
    await createState("p1", { name: "In Review", group: "started" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/work-tracker/projects/p1/states",
    );

    await patchState("s1", { color: "#fff" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/work-tracker/states/s1");

    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
    await deleteState("s1", "s2");
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/work-tracker/states/s1?reassign_to=s2",
    );

    fetchMock.mockResolvedValue(jsonResponse([]));
    await reorderStates("p1", ["s2", "s1"]);
    const [url, init] = fetchMock.mock.calls[3];
    expect(url).toBe("/api/work-tracker/projects/p1/states/reorder");
    expect(JSON.parse(init.body)).toEqual({ ordered_ids: ["s2", "s1"] });
  });
});
