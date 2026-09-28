import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CODING-2248: onboarding creates a module without a folder, captures an idea
// in it, and only asks for the folder when an agent launch needs one.

const transport = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  writeModuleLink: vi.fn(),
}));

vi.mock("../features/work-items/mutationTransport", async () => ({
  ...(await vi.importActual("../features/work-items/mutationTransport")),
  createWorkItem: transport.createWorkItem,
}));

vi.mock("../features/module-links/moduleLinkTransport", async () => ({
  ...(await vi.importActual("../features/module-links/moduleLinkTransport")),
  writeModuleLink: transport.writeModuleLink,
}));

vi.mock("../features/settings/queries", async () => ({
  ...(await vi.importActual("../features/settings/queries")),
  loadIssueTypes: async () => [
    { id: "module-type", name: "Module", level: "module", sort_order: 0 },
    { id: "story-type", name: "Story", level: "task", sort_order: 1 },
  ],
}));

import { ModalHost, useModalStore } from "../app/modal";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DialogHost } from "../app/shell/DialogHost";
import { useDialogStore } from "../app/shell/dialogStore";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal";
import { useConversationComposerStore } from "../features/conversations";
import { getModuleFolder, getModuleLinks, seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { initializeStudioRuntime, studioRuntime } from "../runtime";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor } from "./desktopGraphQlRuntime";

const MODULE_ID = "module-new";
let launches: Array<Record<string, unknown>> = [];
const trust = vi.fn();

function workItemRow(id: string, name: string, parentId: string | null) {
  return {
    id,
    name,
    project_id: "project-1",
    parent_id: parentId,
    state: null,
    rank: "A",
  };
}

function KeymapHarness() {
  useGlobalKeymap([{ kind: "scratch", moduleId: MODULE_ID }]);
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
      launches.push(variables as Record<string, unknown>);
      return {
        terminal_session: {
          __typename: "AgentTerminalSessions",
          agent_run_id: "instant-run-new",
          module_id: (variables as { moduleId: string }).moduleId,
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
  initializeStudioRuntime({ ...studioRuntime(), prepareDirectoryTrust: trust });
}

async function requestConversation() {
  fireEvent.keyDown(window, { key: "i", metaKey: true });
  await act(async () => { await vi.dynamicImportSettled(); });
  return screen.findByRole("dialog", { name: "Module Folder" });
}

function storyCreates() {
  return transport.createWorkItem.mock.calls.filter(
    ([, body]) => (body as { issue_type_id?: string }).issue_type_id === "story-type",
  );
}

describe("overhaul acceptance — folderless onboarding module through first launch", () => {
  beforeEach(() => {
    launches = [];
    installRuntime();
    trust.mockReset().mockResolvedValue({
      status: "already_trusted",
      approval: null,
      directory: "/repos/welcome",
    });
    transport.createWorkItem
      .mockReset()
      .mockImplementation(async (_projectId: string, body: { name: string; issue_type_id: string; parent_id: string | null }) =>
        body.issue_type_id === "module-type"
          ? workItemRow(MODULE_ID, body.name, null)
          : workItemRow("story-new", body.name, body.parent_id));
    transport.writeModuleLink
      .mockReset()
      .mockImplementation(async (moduleId: string, path: string) => {
        seedModuleLinks([
          ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
          { id: `link-${moduleId}`, moduleId, path },
        ]);
      });
    seedModuleLinks([]);
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useOnboardingTourStore.getState().reset();
    useOnboardingTourStore.getState().start("project-1");
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
      selectedModuleId: null,
      selectedTaskId: null,
      sidebarVisible: false,
      editViewZone: "stories",
      workspaces: {},
      activeByTask: {},
      collapsedStateIds: new Set(),
    });
  });

  it("[overhaul-407] creates a folderless onboarding module, captures an idea, and sets up the folder only at launch", async () => {
    render(
      <StudioApolloProvider>
        <KeymapHarness />
        <TasksPane />
        <ModalHost />
        <DialogHost />
      </StudioApolloProvider>,
    );

    // 1. Add Module with a blank folder, deferring folder setup.
    act(() => useModalStore.getState().pushModal({ type: "add-module" }));
    const addModule = await screen.findByRole("dialog", { name: "Add Module" });
    expect(addModule).toHaveTextContent(
      "You can capture ideas now. Choose a local folder before running an agent.",
    );
    fireEvent.change(within(addModule).getByRole("textbox", { name: "Module name" }), {
      target: { value: "Welcome" },
    });
    fireEvent.click(within(addModule).getByRole("button", { name: "Set up folder later" }));

    await waitFor(() => expect(useOnboardingTourStore.getState().step).toBe("story-create"));
    expect(useClientStore.getState().selectedModuleId).toBe(MODULE_ID);
    expect(transport.createWorkItem).toHaveBeenCalledTimes(1);
    expect(transport.writeModuleLink).not.toHaveBeenCalled();
    expect(trust).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Add Module" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Trust module folder?" })).toBeNull();

    // 2. Capture the first idea; still no folder prompt.
    const idea = await screen.findByRole("textbox", { name: "Capture an idea" });
    fireEvent.change(idea, { target: { value: "Plan a simple welcome page" } });
    fireEvent.keyDown(idea, { key: "Enter" });

    await waitFor(() => expect(useOnboardingTourStore.getState().step).toBe("handoff"));
    expect(idea).toHaveValue("");
    expect(storyCreates()).toHaveLength(1);
    expect(storyCreates()[0][1]).toMatchObject({
      name: "Plan a simple welcome page",
      parent_id: MODULE_ID,
    });
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();

    // 3. Launch asks for the folder; cancelling launches nothing.
    let folder = await requestConversation();
    expect(folder).toHaveTextContent("Choose a local folder before running an agent");
    expect(launches).toHaveLength(0);
    fireEvent.click(within(folder).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();
    expect(launches).toHaveLength(0);
    expect(useClientStore.getState().selectedModuleId).toBe(MODULE_ID);
    expect(transport.createWorkItem).toHaveBeenCalledTimes(2);

    // 4. Asking again reopens setup; saving continues the launch exactly once.
    folder = await requestConversation();
    fireEvent.change(within(folder).getByRole("textbox"), { target: { value: "/repos/welcome" } });
    fireEvent.click(within(folder).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0]).toMatchObject({ kind: "instant", moduleId: MODULE_ID });
    expect(transport.writeModuleLink).toHaveBeenCalledTimes(1);
    expect(getModuleFolder(MODULE_ID)).toBe("/repos/welcome");
    expect(screen.queryByRole("dialog", { name: "Module Folder" })).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(launches).toHaveLength(1);
    expect(transport.createWorkItem).toHaveBeenCalledTimes(2);
  });
});
