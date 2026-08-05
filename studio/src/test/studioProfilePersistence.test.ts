import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSidebarEnabled,
  getConfigSnapshot,
  loadConfig,
  seedConfig,
  setModuleFolder,
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
      module_links: [{ module_id: "module-1", path: "/workspace" }],
      recent_project_id: "project-1",
      recent_module_ids: {},
    };
    seedConfig({
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
      if (url.startsWith("/api/config/profiles/") && init?.method === "PUT") {
        const profileIndex = Number(url.split("/").at(-1));
        const profile = JSON.parse(String(init.body));
        return Promise.resolve(
          jsonResponse({
            recent_profile_index: getConfigSnapshot().recentProfileIndex,
            profiles: getConfigSnapshot().profiles.map((current, index) =>
              index === profileIndex ? profile : current,
            ),
          }),
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

  it("replaces and inserts links only on the active profile", async () => {
    const inactiveProfile = {
      ...getConfigSnapshot().profiles[0],
      name: "Inactive",
      module_links: [{ module_id: "module-1", path: "/inactive" }],
    };
    const activeProfile = {
      ...getConfigSnapshot().profiles[0],
      name: "Active",
      agent_prompt: "Keep this prompt",
      module_links: [
        { module_id: "module-1", path: "/old" },
        { module_id: "unrelated", path: "/keep" },
      ],
      recent_project_id: "project-keep",
      recent_module_ids: { "project-keep": "unrelated" },
    };
    seedConfig({
      profiles: [inactiveProfile, activeProfile],
      recentProfileIndex: 1,
    });

    await setModuleFolder("module-1", "/new");
    await setModuleFolder("module-new", "/added");

    expect(getConfigSnapshot().profiles).toEqual([
      inactiveProfile,
      {
        ...activeProfile,
        module_links: [
          { module_id: "module-1", path: "/new" },
          { module_id: "unrelated", path: "/keep" },
          { module_id: "module-new", path: "/added" },
        ],
      },
    ]);
    const profileWrites = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === "/api/config/profiles/1" && init?.method === "PUT",
    );
    expect(profileWrites).toHaveLength(2);
    expect(JSON.parse(String(profileWrites[1][1].body))).toEqual({
      ...activeProfile,
      module_links: [
        { module_id: "module-1", path: "/new" },
        { module_id: "unrelated", path: "/keep" },
        { module_id: "module-new", path: "/added" },
      ],
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

    await loadConfig();

    expect(getConfigSnapshot().features).toEqual({
      sidebar: true,
      projects: false,
    });
    expect(isSidebarEnabled()).toBe(true);
    expect(isSidebarEnabled(getConfigSnapshot())).toBe(true);
  });
});
