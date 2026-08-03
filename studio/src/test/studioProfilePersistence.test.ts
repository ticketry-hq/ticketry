import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSidebarEnabled,
  useConfigStore,
} from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Studio profile persistence", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    const currentProfile = {
      name: "Local",
      workspace_slug: "meml",
      agent_prompt: null,
      agent_prompts: {
        Idea: "custom idea",
        Refinement: "custom refinement",
      },
      module_folders: { "module-1": "/workspace" },
      recent_project_id: "project-1",
      recent_module_ids: {},
    };
    useConfigStore.setState({
      recentProfileIndex: 0,
      features: { sidebar: false, projects: false },
      profiles: [currentProfile],
    });
    useTasksStore.setState({
      selectedProjectId: null,
      selectedModuleId: null,
      modules: [],
      tasks: [],
    });

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/config/profiles/0" && init?.method === "PUT") {
        const profile = JSON.parse(String(init.body));
        return Promise.resolve(
          jsonResponse({ recent_profile_index: 0, profiles: [profile] }),
        );
      }
      if (url === "/api/work-tracker/projects/project-2/modules") {
        return Promise.resolve(jsonResponse([]));
      }
      if (url === "/api/runs/module-activity?project_id=project-2") {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it("preserves prompt overrides when project recency is saved", async () => {
    await useTasksStore.getState().selectProject("project-2");

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/config/profiles/0" && init?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall![1].body)).agent_prompts).toEqual({
      Idea: "custom idea",
      Refinement: "custom refinement",
    });
  });

  it("loads the resolved sidebar feature into typed Studio state", async () => {
    fetchMock.mockImplementationOnce((url: string) => {
      if (url !== "/api/config") throw new Error(`Unexpected request: ${url}`);
      return Promise.resolve(
        jsonResponse({
          recent_profile_index: null,
          profiles: [],
          features: { sidebar: true, projects: false },
        }),
      );
    });

    await useConfigStore.getState().loadConfig();

    expect(useConfigStore.getState().features).toEqual({
      sidebar: true,
      projects: false,
    });
    expect(isSidebarEnabled()).toBe(true);
    expect(isSidebarEnabled(useConfigStore.getState())).toBe(true);
  });
});
