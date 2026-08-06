import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import { seedConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function moduleWorkItem(id: string, parentId = "module-linked") {
  return {
    id,
    key: `CODING-${id}`,
    name: "Loaded story",
    project_id: "project-1",
    sequence_id: 1,
    issue_type: { id: "story", name: "Story", level: "task" },
    state: { id: "todo", name: "Todo", group: "backlog", color: null },
    description: null,
    parent_id: parentId,
    sub_issues_count: 0,
  };
}

describe("Studio module-selection folder gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    seedConfig({
      profiles: [
        {
          name: "Local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [
            { module_id: "module-current", path: "/repos/current" },
          ],
          recent_project_id: "project-1",
          recent_module_ids: { "project-1": "module-current" },
        },
      ],
      recentProfileIndex: 0,
    });
    useModalStore.setState({ modalStack: [] });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-current",
      tasks: [{ id: "existing-task" }] as never,
      subtasks: {},
      selectedTaskId: "existing-task",
      details: null,
    });
  });

  it("opens folder collection before entering a pathless module", async () => {
    await useTasksStore.getState().selectModule("module-missing");

    expect(useTasksStore.getState()).toMatchObject({
      selectedModuleId: "module-current",
      tasks: [{ id: "existing-task" }],
      selectedTaskId: "existing-task",
    });
    expect(useModalStore.getState().modalStack).toEqual([
      {
        type: "module-folder",
        payload: {
          moduleId: "module-missing",
          resumeModuleSelection: true,
        },
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selects and hydrates a linked module without prompting", async () => {
    seedConfig((config) => ({
      profiles: [
        {
          ...config.profiles[0],
          module_links: [
            ...config.profiles[0].module_links,
            { module_id: "module-linked", path: "/repos/linked" },
          ],
        },
      ],
    }));
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/config/profiles/0" && init?.method === "PUT") {
        const profile = JSON.parse(String(init.body));
        return Promise.resolve(
          jsonResponse({
            recent_profile_index: 0,
            profiles: [profile],
          }),
        );
      }
      if (url.endsWith("/modules/module-linked/work-items")) {
        return Promise.resolve(jsonResponse([moduleWorkItem("story-1")]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "todo",
              name: "Todo",
              group: "backlog",
              color: null,
              sort_order: 0,
            },
          ]),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().selectModule("module-linked");

    expect(useTasksStore.getState().selectedModuleId).toBe("module-linked");
    expect(useTasksStore.getState().tasks.map((task) => task.id)).toContain(
      "story-1",
    );
    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("resumes a pending selection once after folder persistence succeeds", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/config/profiles/0" && init?.method === "PUT") {
        const profile = JSON.parse(String(init.body));
        return Promise.resolve(
          jsonResponse({
            recent_profile_index: 0,
            profiles: [profile],
          }),
        );
      }
      if (url.endsWith("/modules/module-missing/work-items")) {
        return Promise.resolve(
          jsonResponse([moduleWorkItem("story-2", "module-missing")]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "todo",
              name: "Todo",
              group: "backlog",
              color: null,
              sort_order: 0,
            },
          ]),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await useTasksStore.getState().selectModule("module-missing");
    render(
      <ModuleFolder
        payload={{
          moduleId: "module-missing",
          resumeModuleSelection: true,
        }}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useTasksStore.getState().selectedModuleId).toBe("module-missing");
    expect(useTasksStore.getState().tasks.map((task) => task.id)).toContain(
      "story-2",
    );
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/modules/module-missing/work-items"),
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/config/profiles/0" && init?.method === "PUT",
      ),
    ).toHaveLength(2);
  });

  it("keeps the pending module out of the workspace when persistence fails", async () => {
    fetchMock.mockRejectedValue(new Error("settings unavailable"));
    await useTasksStore.getState().selectModule("module-missing");
    render(
      <ModuleFolder
        payload={{
          moduleId: "module-missing",
          resumeModuleSelection: true,
        }}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save the module folder. Retry to continue.",
    );
    expect(useTasksStore.getState()).toMatchObject({
      selectedModuleId: "module-current",
      tasks: [{ id: "existing-task" }],
      selectedTaskId: "existing-task",
    });
    expect(useModalStore.getState().modalStack).toHaveLength(1);
  });

  it("cancels folder collection without changing the current workspace", async () => {
    await useTasksStore.getState().selectModule("module-missing");
    render(
      <ModuleFolder
        payload={{
          moduleId: "module-missing",
          resumeModuleSelection: true,
        }}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/not-saved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useTasksStore.getState()).toMatchObject({
      selectedModuleId: "module-current",
      tasks: [{ id: "existing-task" }],
      selectedTaskId: "existing-task",
    });
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use a module link from an inactive profile", async () => {
    seedConfig((config) => ({
      profiles: [
        {
          ...config.profiles[0],
          name: "Inactive",
          module_links: [
            { module_id: "module-missing", path: "/repos/inactive" },
          ],
        },
        {
          ...config.profiles[0],
          name: "Active",
          module_links: [
            { module_id: "module-current", path: "/repos/current" },
          ],
        },
      ],
      recentProfileIndex: 1,
    }));

    await useTasksStore.getState().selectModule("module-missing");

    expect(useTasksStore.getState().selectedModuleId).toBe("module-current");
    expect(useModalStore.getState().modalStack).toEqual([
      {
        type: "module-folder",
        payload: {
          moduleId: "module-missing",
          resumeModuleSelection: true,
        },
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
