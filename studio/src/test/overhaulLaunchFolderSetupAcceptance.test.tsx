import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../features/module-links/moduleLinkTransport", async () => ({
  ...(await vi.importActual("../features/module-links/moduleLinkTransport")),
  writeModuleLink: vi.fn(),
}));

import { ModalHost, useModalStore } from "../app/modal";
import { DialogHost } from "../app/shell/DialogHost";
import { useDialogStore } from "../app/shell/dialogStore";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useConversationComposerStore } from "../features/conversations";
import {
  getModuleFolder,
  getModuleLinks,
  seedModuleLinks,
} from "../features/module-links";
import * as moduleLinkTransport from "../features/module-links/moduleLinkTransport";
import { useStudioStore } from "../features/projects/store";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { initializeStudioRuntime, studioRuntime, type StudioRuntime } from "../runtime";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

// CODING-2245: an existing folderless module (seeded here, as onboarding will
// create it) plans freely, but a conversation launch first requires its folder.

const writeModuleLink = moduleLinkTransport.writeModuleLink as ReturnType<typeof vi.fn>;
let creates: Array<Record<string, unknown>> = [];
let failLaunch = false;

function installTrust(
  prepareDirectoryTrust: NonNullable<StudioRuntime["prepareDirectoryTrust"]>,
): void {
  initializeStudioRuntime({ ...studioRuntime(), prepareDirectoryTrust });
}

function KeymapHarness() {
  useGlobalKeymap([{ kind: "scratch", moduleId: "module-1" }]);
  return null;
}

function installRuntime() {
  const terminalExecutor = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [],
    readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: async () => [],
    readScratchResumableTerminalSessions: async () => [],
  });
  installDesktopGraphQlRuntime(async (document, variables) => {
    const operationName = documentOperationName(document);
    if (operationName === "InstantRunTickets") return { tickets: [] } as never;
    if (operationName === "CreateTerminalSession") {
      creates.push(variables as Record<string, unknown>);
      if (failLaunch) throw new Error("provider exited");
      return {
        terminal_session: {
          __typename: "AgentTerminalSessions",
          agent_run_id: "instant-run-new",
          module_id: "module-1",
          scope: "instant",
          doc_rel_path: null,
          created_at: "2026-09-28T12:00:00Z",
          agent_run: {
            __typename: "AgentRuns",
            id: "instant-run-new",
            agent: "claude",
            launch_state: null,
            launch_model: null,
          },
        },
      } as never;
    }
    if (operationName === "WorkTrackerModuleOpen") {
      return {
        module: { __typename: "WorktrackerIssueConnection", nodes: [] },
        work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
      } as never;
    }
    return terminalExecutor(document, variables);
  });
}

async function renderFolderlessModule() {
  render(
    <StudioApolloProvider>
      <KeymapHarness />
      <TasksPane />
      <ModalHost />
      <DialogHost />
    </StudioApolloProvider>,
  );
  await screen.findByRole("treeitem", { name: /New conversation/ });
}

async function requestConversation() {
  fireEvent.keyDown(window, { key: "i", metaKey: true });
  await act(async () => { await vi.dynamicImportSettled(); });
  return screen.findByRole("dialog", { name: "Module Folder" });
}

function enterFolder(dialog: HTMLElement, path: string) {
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: path } });
}

describe("overhaul acceptance — folder setup at agent launch", () => {
  beforeEach(() => {
    creates = [];
    failLaunch = false;
    installRuntime();
    installTrust((async () => ({
      status: "already_trusted",
      approval: null,
      directory: "/repos/welcome",
    })));
    writeModuleLink
      .mockReset()
      .mockImplementation(async (moduleId: string, path: string) => {
        seedModuleLinks([
          ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
          { id: `link-${moduleId}`, moduleId, path },
        ]);
      });
    seedModuleLinks([{ id: "link-2", moduleId: "module-2", path: "/repos/other" }]);
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    useConversationComposerStore.setState({ open: false, draft: "" });
    useModalStore.setState({ modalStack: [] });
    useDialogStore.setState({ dialogs: [] });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      sidebarVisible: false,
      editViewZone: "stories",
      workspaces: {},
      activeByTask: {},
      collapsedStateIds: new Set(),
    });
  });

  it("[overhaul-396] asks for a required folder, with its reason, before a folderless module launches an agent", async () => {
    await renderFolderlessModule();

    const dialog = await requestConversation();

    expect(dialog).toHaveTextContent("Choose a local folder before running an agent");
    expect(within(dialog).getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Local folder (required)",
    );
    expect(dialog).not.toHaveTextContent(/optional/i);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(creates).toHaveLength(0);
  });

  it("[overhaul-397] continues the original launch once, for the original module, after the folder saves", async () => {
    await renderFolderlessModule();
    const dialog = await requestConversation();

    // Navigating elsewhere while setup is open must not redirect the launch.
    act(() => useClientStore.setState({ selectedModuleId: "module-2" }));
    enterFolder(dialog, "/repos/welcome");
    const save = within(dialog).getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(creates).toHaveLength(1));
    expect(creates[0]).toMatchObject({ kind: "instant", moduleId: "module-1" });
    expect(getModuleFolder("module-1")).toBe("/repos/welcome");
    expect(writeModuleLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(creates).toHaveLength(1);
  });

  it("[overhaul-398] launches nothing when setup or trust is cancelled, and lets a later launch ask again", async () => {
    installTrust((async (provider, _directory, approval) => ({
      status: approval ? "prepared" : "approval_required",
      approval: approval ? null : `${provider}-approval`,
      directory: "/repos/welcome",
    })));
    await renderFolderlessModule();

    let dialog = await requestConversation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();
    expect(creates).toHaveLength(0);
    expect(useClientStore.getState().selectedModuleId).toBe("module-1");
    expect(screen.getByRole("treeitem", { name: /New conversation/ })).toBeVisible();

    dialog = await requestConversation();
    enterFolder(dialog, "/repos/welcome");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const consent = await screen.findByRole("dialog", { name: "Trust module folder?" });
    fireEvent.click(within(consent).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(writeModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-1")).toBeUndefined();
    expect(creates).toHaveLength(0);

    dialog = await requestConversation();
    expect(dialog).toHaveTextContent("Choose a local folder before running an agent");
  });

  it("[overhaul-399] blocks launch on invalid input or a failed save, and keeps a saved folder when launch fails", async () => {
    writeModuleLink.mockRejectedValueOnce(new Error("save failed"));
    await renderFolderlessModule();
    const dialog = await requestConversation();

    enterFolder(dialog, "relative/folder");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    enterFolder(dialog, "/repos/welcome");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Could not save the module folder. Retry to continue.",
    );
    expect(creates).toHaveLength(0);
    expect(getModuleFolder("module-1")).toBeUndefined();

    failLaunch = true;
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(await screen.findByText("Conversation did not start")).toBeVisible();
    expect(getModuleFolder("module-1")).toBe("/repos/welcome");
  });

  it("[overhaul-400] launches a configured module through the existing flow without folder setup", async () => {
    seedModuleLinks([{ id: "link-1", moduleId: "module-1", path: "/repos/ticketry" }]);
    await renderFolderlessModule();

    fireEvent.keyDown(window, { key: "i", metaKey: true });

    await waitFor(() => expect(creates).toHaveLength(1));
    expect(creates[0]).toMatchObject({ kind: "instant", moduleId: "module-1" });
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();
  });
});
