import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfigStore as useAgentConfigStore } from "../features/agents/stores/configStore";
import { useConfigStore as useStudioConfigStore } from "../features/studio/stores/configStore";
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
    useAgentConfigStore.setState({
      recentProfileIndex: 0,
      profiles: [currentProfile],
    });
    useStudioConfigStore.setState({
      recentProfileIndex: 0,
      profiles: [
        {
          ...currentProfile,
          api_url: "http://tracker.test",
          api_key: "",
          agent_prompts: {},
        },
      ],
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
});
