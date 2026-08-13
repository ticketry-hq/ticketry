import { describe, expect, it, vi } from "vitest";
import {
  getConfigSnapshot,
  loadConfig,
  selectProfile,
  setModuleFolder,
} from "../features/studio/stores/configStore";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

const startup = {
  endpoints: {
    workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
    agentApi: "http://127.0.0.1:8787/api",
    statusApi: "http://127.0.0.1:8787/api",
    statusWebSocket: "ws://127.0.0.1:8787/ws/status",
    terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
  },
  values: { workTrackerApiKey: "" },
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

describe("profile settings desktop runtime acceptance", () => {
  it("[overhaul-78] selects a profile and persists its module folder through generated GraphQL only", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let settings = {
      recent_profile_index: 0,
      profiles: [
        {
          name: "Laptop",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [],
          recent_project_id: null,
          recent_module_ids: {},
        },
        {
          name: "Desktop",
          workspace_slug: "meml",
          agent_prompt: "Keep changes focused.",
          agent_prompts: { codex: "Use tests." },
          module_links: [],
          recent_project_id: "project-1",
          recent_module_ids: { "project-1": "module-1" },
        },
      ],
      features: { sidebar: true, projects: true },
    };
    const operationNames: string[] = [];
    const graphqlExecute = vi.fn(async (requestJson: string) => {
      const request = JSON.parse(requestJson) as {
        operationName: string;
        variables: { index?: number; profile?: typeof settings.profiles[number] };
      };
      operationNames.push(request.operationName);
      if (request.operationName === "LoadLocalSettings") {
        return JSON.stringify({ data: { local_settings: settings } });
      }
      if (request.operationName === "SelectLocalProfile") {
        settings = { ...settings, recent_profile_index: request.variables.index ?? 0 };
        return JSON.stringify({ data: { select_local_profile: settings } });
      }
      if (request.operationName === "WorkTrackerProjects") {
        return JSON.stringify({ data: { projects: [] } });
      }
      if (request.operationName === "ReplaceLocalProfile") {
        const index = request.variables.index ?? 0;
        settings = {
          ...settings,
          profiles: settings.profiles.map((profile, position) =>
            position === index ? request.variables.profile! : profile
          ),
        };
        return JSON.stringify({ data: { replace_local_profile: settings } });
      }
      throw new Error(`Unexpected operation ${request.operationName}`);
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));

    await loadConfig();
    await selectProfile(1);
    await setModuleFolder("module-1", "/repos/ticketry");

    expect(operationNames).toEqual([
      "LoadLocalSettings",
      "SelectLocalProfile",
      "WorkTrackerProjects",
      "ReplaceLocalProfile",
    ]);
    expect(getConfigSnapshot().recentProfileIndex).toBe(1);
    expect(getConfigSnapshot().profiles[1]).toMatchObject({
      name: "Desktop",
      workspace_slug: "meml",
      agent_prompt: "Keep changes focused.",
      agent_prompts: { codex: "Use tests." },
      recent_project_id: "project-1",
      recent_module_ids: { "project-1": "module-1" },
      module_links: [{ module_id: "module-1", path: "/repos/ticketry" }],
    });
    expect(fetchMock).not.toHaveBeenCalled();

    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });
});
