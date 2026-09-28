import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  terminalApi,
  useStudioStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";

vi.mock("../features/module-links/moduleLinkTransport", async () => ({
  ...(await vi.importActual("../features/module-links/moduleLinkTransport")),
  writeModuleLink: vi.fn(),
}));

vi.mock("../features/agents/terminal/internal/mutationTransport", async () => ({
  ...(await vi.importActual("../features/agents/terminal/internal/mutationTransport")),
  createDefaultInteractiveTaskLaunch: vi.fn(),
}));

const moduleLinks = await import("../features/module-links");
const moduleLinkTransport = await import("../features/module-links/moduleLinkTransport");
const launchTransport = await import("../features/agents/terminal/internal/mutationTransport");
const { RunItemAction } = await import(
  "../app/shell/ticket-workspace/selected-ticket/details/NormalRunAction"
);
const { initializeStudioRuntime, studioRuntime } = await import("../runtime");

const writeModuleLink = moduleLinkTransport.writeModuleLink as ReturnType<typeof vi.fn>;
const defaultLaunch = launchTransport.createDefaultInteractiveTaskLaunch as ReturnType<typeof vi.fn>;

function folderlessModule(): void {
  moduleLinks.seedModuleLinks([]);
  initializeStudioRuntime({
    ...studioRuntime(),
    prepareDirectoryTrust: async () => ({
      status: "already_trusted",
      approval: null,
      directory: "/repos/welcome",
    }),
  });
  writeModuleLink.mockImplementation(async (moduleId: string, path: string) => {
    moduleLinks.seedModuleLinks([{ id: `link-${moduleId}`, moduleId, path }]);
  });
}

async function saveFolder(): Promise<void> {
  await act(async () => { await vi.dynamicImportSettled(); });
  const dialog = await screen.findByRole("dialog", { name: "Module Folder" });
  expect(dialog).toHaveTextContent("Choose a local folder before running an agent");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "/repos/welcome" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
}

describe("overhaul acceptance — work-item launch folder setup", () => {
  it("[overhaul-401] requires the folder before work-item launches and continues them for the original item", async () => {
    folderlessModule();
    useStudioStore.setState({ selectedProjectId: "project-570" });
    defaultLaunch.mockResolvedValue(undefined);
    const task = {
      id: "task-570",
      project_id: "project-570",
      sub_issues_count: 0,
    } as never;
    render(
      <>
        <RunItemAction task={task} moduleId="module-570" />
        {workspaceView({
          launchContext: {
            kind: "task",
            taskId: "task-570",
            projectId: "project-570",
            moduleId: "module-570",
          },
        })}
      </>,
    );

    // ＋ Agent: no picker, and no run, until the folder is saved.
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    await saveFolder();
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    fireEvent.click(within(picker).getByText("codex"));
    await waitFor(() =>
      expect(terminalApi.createTerminalRun).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: "task-570", module_id: "module-570" }),
      ),
    );
    expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(1);

    // Run: cancelling setup launches nothing; a saved folder runs once.
    moduleLinks.seedModuleLinks([]);
    fireEvent.click(screen.getByRole("button", { name: "Run item" }));
    await act(async () => { await vi.dynamicImportSettled(); });
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Module Folder" }))
        .getByRole("button", { name: "Cancel" }),
    );
    expect(defaultLaunch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run item" }));
    await saveFolder();
    await waitFor(() => expect(defaultLaunch).toHaveBeenCalledTimes(1));
    expect(defaultLaunch).toHaveBeenCalledWith({
      projectId: "project-570",
      issueId: "task-570",
      moduleId: "module-570",
    });
    expect(moduleLinks.getModuleFolder("module-570")).toBe("/repos/welcome");
  });
});
