import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudioApp from "../app/StudioApp";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DialogHost } from "../app/shell/DialogHost";
import { useDialogStore } from "../app/shell/dialogStore";
import { useStudioStore } from "../features/projects";
import { WorkTrackerOnboardingDocument } from "../features/projects/generated/projects.documents";
import {
  createBrowserRuntime,
  initializeStudioRuntime,
  type WorkTrackerGraphQlExecute,
} from "../runtime";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { studioApolloClient } from "../shared/apollo/client";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";

const PROJECT_ID = "345113f3-2578-4285-aed7-b86eb7c4fd78";
const MODULE_ID = "12d17fb4-643c-4bf5-a16a-f4e974e175f8";
const STORY_ID = "7692cc90-fffc-4291-a7ad-946ddb8a07d7";
const MODULE_TYPE_ID = "20b3aa0b-9de6-4419-a260-a0a0a82fa4a7";
const STORY_TYPE_ID = "17aa004c-c479-41d3-86fa-928b9398ee31";
const IDEAS_STATE_ID = "07e7d3c4-5e2a-49d8-bc30-831655b2a2c5";
const CREATED_AT = "2026-09-23T06:30:00Z";

type ProviderChoice = "none" | "codex";

const connection = <T,>(nodes: T[]) => ({
  __typename: "Connection",
  nodes,
});

class DurableOnboardingBoundary {
  onboardingRequired = true;
  providerChoice: ProviderChoice = "none";
  moduleCreated = false;
  storyCreated = false;
  currentStageBinding = false;
  linkedFolder: string | null = null;
  readonly operations: string[] = [];
  readonly createdNames: string[] = [];
  readonly acknowledgementProjectIds: string[] = [];
  acknowledgementAttempts = 0;
  failProjectOpen = false;
  private heldAcknowledgement: {
    promise: Promise<void>;
    reject: (cause: Error) => void;
  } | null = null;

  holdNextAcknowledgement(): void {
    if (this.heldAcknowledgement) {
      throw new Error("An onboarding acknowledgement is already held");
    }
    let reject!: (cause: Error) => void;
    const promise = new Promise<void>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    this.heldAcknowledgement = { promise, reject };
  }

  rejectHeldAcknowledgement(cause: Error): void {
    if (!this.heldAcknowledgement) {
      throw new Error("No onboarding acknowledgement is held");
    }
    this.heldAcknowledgement.reject(cause);
  }

  private providerCatalog() {
    const active = this.providerChoice === "codex";
    const provider = {
      __typename: "WorktrackerProvider",
      id: "provider-codex",
      slug: "codex",
      activated: active,
      supports_unattended: true,
    };
    return {
      __typename: "ProviderCatalog",
      configurable_providers: [provider],
      providers: active ? [provider] : [],
      agent_models: [{
        __typename: "WorktrackerAgentmodel",
        id: "model-luna",
        provider: provider.id,
        name: "gpt-5.6-luna",
        reasoning_levels: connection([{
          __typename: "WorktrackerAgentmodelreasoninglevel",
          id: 1,
          reasoning_level_id: "reasoning-medium",
        }]),
      }],
      reasoning_levels: [{
        __typename: "WorktrackerReasoninglevel",
        id: "reasoning-medium",
        name: "medium",
      }],
      codex_profiles: [],
      global_default: active ? {
        __typename: "GlobalLaunchDefault",
        provider: "codex",
        profile: null,
        model: "gpt-5.6-luna",
        reasoning: "medium",
      } : null,
    };
  }

  private project() {
    return {
      __typename: "WorktrackerProject",
      id: PROJECT_ID,
      name: "Coding",
      slug: "CDN",
      description: "",
      created_at: CREATED_AT,
      onboarding_required: this.onboardingRequired,
    };
  }

  private state() {
    return {
      __typename: "WorktrackerState",
      id: IDEAS_STATE_ID,
      project: PROJECT_ID,
      name: "Ideas",
      group: "backlog",
      color: null,
      sort_order: 0,
      is_protected: true,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    };
  }

  private issueType(id: string, name: string, level: "module" | "task") {
    return {
      __typename: "WorktrackerIssuetype",
      id,
      project: PROJECT_ID,
      name,
      level,
      color: null,
      sort_order: level === "module" ? 0 : 1,
      start_state: level === "task" ? IDEAS_STATE_ID : null,
      workflow_revision: 1,
      is_pathfind: false,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      transitions: connection([]),
      launch_bindings: connection(level === "task" && this.currentStageBinding ? [{
        __typename: "WorktrackerIssuetypelaunchbinding",
        id: 1,
        issue_type: STORY_TYPE_ID,
        state: IDEAS_STATE_ID,
        prompt: "Clarify the desired result before writing code.",
        required_skills: [],
        stage_skills: [],
        profile: null,
        model: null,
        reasoning: null,
        auto_start: false,
        subtree_run_enabled: false,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
        state_record: {
          __typename: "WorktrackerState",
          id: IDEAS_STATE_ID,
          sort_order: 0,
        },
      }] : []),
    };
  }

  private moduleRow() {
    return {
      __typename: "WorktrackerIssue",
      id: MODULE_ID,
      name: "Onboarding module",
      rank: "a",
      project_id: PROJECT_ID,
      sequence_id: 1,
      is_archived: false,
      issue_type: MODULE_TYPE_ID,
      project: {
        __typename: "WorktrackerProject",
        id: PROJECT_ID,
        slug: "CDN",
      },
    };
  }

  private storyRow() {
    return {
      __typename: "WorktrackerIssue",
      id: STORY_ID,
      name: "Keep my selected story",
      description: "",
      rank: "a",
      project_id: PROJECT_ID,
      sequence_id: 2,
      state_id: IDEAS_STATE_ID,
      state_revision: 1,
      workspace_tab_order: [],
      parent_id: MODULE_ID,
      module_id: MODULE_ID,
      sprint_id: null,
      is_archived: false,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      issue_type_id: STORY_TYPE_ID,
      project: {
        __typename: "WorktrackerProject",
        id: PROJECT_ID,
        slug: "CDN",
      },
      state_record: this.state(),
      issue_type_record: this.issueType(STORY_TYPE_ID, "Story", "task"),
      children: connection([]),
      blocked_by_edges: connection([]),
      blocks_edges: connection([]),
    };
  }

  private fullModuleRow() {
    return {
      ...this.storyRow(),
      ...this.moduleRow(),
      description: "",
      state_id: null,
      state_revision: 1,
      workspace_tab_order: [],
      parent_id: null,
      module_id: null,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      issue_type_id: MODULE_TYPE_ID,
      state_record: null,
      issue_type_record: this.issueType(MODULE_TYPE_ID, "Module", "module"),
    };
  }

  private projectOpen() {
    return {
      project: connection([this.project()]),
      modules: connection(this.moduleCreated ? [this.moduleRow()] : []),
      module_presentations: connection([]),
      states: connection([this.state()]),
      issue_types: connection([
        this.issueType(MODULE_TYPE_ID, "Module", "module"),
        this.issueType(STORY_TYPE_ID, "Story", "task"),
      ]),
      provider_catalog: this.providerCatalog(),
    };
  }

  readonly execute: WorkTrackerGraphQlExecute = async (document, variables) => {
    const operation = documentOperationName(document);
    this.operations.push(operation);
    const input = variables as Record<string, unknown>;

    switch (operation) {
      case "WorkTrackerProjects":
        return {
          projects: connection([this.project()]),
          module_presentations: connection([]),
        } as never;
      case "WorkTrackerOnboarding":
        return { projects: connection([this.project()]) } as never;
      case "WorkTrackerProjectOpen":
        if (this.failProjectOpen) {
          throw new Error("Workflow read unavailable");
        }
        return this.projectOpen() as never;
      case "WorkTrackerProjectStates":
        return { states: connection([this.state()]) } as never;
      case "WorkTrackerProjectIssueTypes":
        return { issue_types: this.projectOpen().issue_types } as never;
      case "LoadModuleLinks":
        return {
          moduleLinks: connection(this.linkedFolder ? [{
            __typename: "ModuleLinks",
            id: "module-link-1",
            moduleId: MODULE_ID,
            path: this.linkedFolder,
          }] : []),
        } as never;
      case "SetModuleLink":
        this.linkedFolder = String(input.path);
        return {
          set_module_link: {
            __typename: "ModuleLinks",
            id: "module-link-1",
            moduleId: String(input.moduleId),
            path: this.linkedFolder,
          },
        } as never;
      case "LoadKeybindingSetting":
        return { keybinding_setting: null } as never;
      case "LiveRunStatusPreload":
        return { agent_run_holdings: [], automation_attempts: [] } as never;
      case "LoadProviderCatalog":
        return { provider_catalog: this.providerCatalog() } as never;
      case "UpdateProviderCatalog":
        this.providerChoice = (input.activatedProviders as string[]).includes("codex")
          ? "codex"
          : "none";
        return { update_provider_catalog: this.providerCatalog() } as never;
      case "CreateWorkTrackerWorkItem": {
        this.createdNames.push(String(input.name));
        const module = input.issueTypeId === compactWorktrackerId(MODULE_TYPE_ID);
        if (module) this.moduleCreated = true;
        else this.storyCreated = true;
        return {
          create_work_item: module ? this.fullModuleRow() : this.storyRow(),
        } as never;
      }
      case "WorkTrackerModuleOpen":
        return {
          module: connection(this.moduleCreated ? [this.moduleRow()] : []),
          work_items: connection(this.storyCreated ? [this.storyRow()] : []),
        } as never;
      case "WorkTrackerWorkItem":
        return {
          work_item: connection(this.storyCreated ? [this.storyRow()] : []),
        } as never;
      case "AcknowledgeWorkTrackerOnboarding": {
        this.acknowledgementAttempts += 1;
        this.acknowledgementProjectIds.push(String(input.projectId));
        const held = this.heldAcknowledgement;
        if (held) {
          try {
            await held.promise;
          } finally {
            this.heldAcknowledgement = null;
          }
        }
        this.onboardingRequired = false;
        return { acknowledge_onboarding: this.project() } as never;
      }
      case "WorkItemEndedRuns":
        return {
          work_item: connection(this.storyCreated ? [{
            __typename: "WorktrackerIssue",
            id: STORY_ID,
            project_id: PROJECT_ID,
            module_id: MODULE_ID,
            ended_runs: connection([]),
          }] : []),
        } as never;
      case "TaskTerminalSessions":
      case "ScratchTerminalSessions":
        return { terminal_sessions: { sessions: [] } } as never;
      case "TaskResumableTerminalSessions":
      case "ScratchResumableTerminalSessions":
        return { resumable_sessions: [] } as never;
      case "TaskDocumentRegistry":
      case "ScratchDocumentRegistry":
        return { document_registry: connection([]) } as never;
      case "RefreshTaskDocumentRegistry":
      case "RefreshScratchDocumentRegistry":
        return { refresh_task_document_registry: [] } as never;
      case "CurrentWorktrees":
        return { worktrees: connection([]) } as never;
      case "WorkTrackerAttachments":
        return { attachments: connection([]) } as never;
      case "ProjectRunStatus":
        return {
          runs: connection([]),
          automation_attempts: connection([]),
        } as never;
      default:
        throw new Error(`Unexpected GraphQL operation ${operation}`);
    }
  };
}

function installBoundary(boundary: DurableOnboardingBoundary): void {
  const browser = createBrowserRuntime({ environment: {} });
  const graphQlTransport = () => ({
    graphql_execute: async (requestJson: string) => {
      const request = JSON.parse(requestJson) as {
        operationName: string;
        variables: Record<string, unknown>;
      };
      const data = await boundary.execute(
        { operationName: request.operationName } as never,
        request.variables,
      );
      return JSON.stringify({ data });
    },
    graphql_subscribe: async () => '{"type":"accepted"}',
    graphql_unsubscribe: async () => true,
  });
  const route = ((routes: Parameters<typeof browser.readWorkTracker>[0]) =>
    routes.graphQl(boundary.execute)) as typeof browser.readWorkTracker;
  initializeStudioRuntime({
    ...browser,
    graphQlTransport,
    readWorkTracker: route,
    writeWorkTracker: route,
    readSettings: route,
    writeSettings: route,
    statusStream: () => null,
    prepareDirectoryTrust: async (_provider, directory) => ({
      status: "already_trusted",
      approval: null,
      directory,
    }),
  });
}

function mountApplication() {
  return render(
    <StudioApolloProvider>
      <StudioApp />
      <ModalHost />
      <DialogHost />
    </StudioApolloProvider>,
  );
}

function resetClientRuntime(): void {
  useOnboardingTourStore.getState().reset();
  useStudioStore.setState({ selectedProjectId: null, activeView: "backlog", error: null });
  useClientStore.setState({
    selectedModuleId: null,
    selectedTaskId: null,
    workspaceSelection: { kind: "task" },
    workspaces: {},
    activeByTask: {},
    sidebarVisible: true,
    panelLayout: [18, 44, 38],
    storySearchQuery: "",
    expandedIdsByModule: {},
    collapsedStateIds: new Set(),
  });
  useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
  useDialogStore.setState({ dialogs: [] });
}

async function reachStoryCoachMark(choice: ProviderChoice): Promise<HTMLElement> {
  expect(await screen.findByTestId("onboarding-welcome")).toBeVisible();
  const codex = await screen.findByRole("checkbox", { name: "I use codex" });
  if (choice === "codex") fireEvent.click(codex);
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));

  const modulesPane = await screen.findByTestId("pane-modules");
  fireEvent.click(within(modulesPane).getByRole("button", {
    name: "+ Add Module",
  }));
  const dialog = await screen.findByRole("dialog", { name: "Add Module" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Module name" }), {
    target: { value: "Onboarding module" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Module folder" }), {
    target: { value: "/repos/ticketry" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create module" }));

  return screen.findByRole("textbox", {
    name: "Capture an idea",
  });
}

async function reachFinalCoachMark(choice: ProviderChoice): Promise<HTMLElement> {
  const capture = await reachStoryCoachMark(choice);
  fireEvent.change(capture, { target: { value: "Keep my selected story" } });
  fireEvent.keyDown(capture, { key: "Enter" });

  const finish = await screen.findByRole("button", { name: "Finish tour" });
  await expectSelectedOnboardingStory();
  return finish;
}

async function expectSelectedOnboardingStory(): Promise<void> {
  await waitFor(() => expect(useClientStore.getState()).toMatchObject({
    selectedModuleId: MODULE_ID,
    selectedTaskId: STORY_ID,
  }));
  expect(await screen.findByRole("treeitem", {
    name: /Keep my selected story/,
  })).toHaveAttribute("aria-selected", "true");
}

function expectNoLaunchOperations(boundary: DurableOnboardingBoundary): void {
  expect(boundary.operations).not.toContain("CreateTerminalSession");
  expect(boundary.operations).not.toContain("CreateExecutionGraphRun");
  expect(boundary.operations).not.toContain("RunWorkTrackerWorkItemNow");
  expect(boundary.operations).not.toContain("TransitionWorkTrackerWorkItem");
  expect(boundary.operations).not.toContain("UpdateWorkTrackerWorkItem");
}

function expectCreatedContentOnce(boundary: DurableOnboardingBoundary): void {
  expect(boundary.operations.filter((operation) =>
    operation === "CreateWorkTrackerWorkItem"
  )).toHaveLength(2);
}

function watchForWelcome(): { returned: () => boolean; stop: () => void } {
  let welcomeReturned = false;
  const selector = '[data-testid="onboarding-welcome"]';
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof Element
          && (node.matches(selector) || node.querySelector(selector))
        ) {
          welcomeReturned = true;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    returned: () => welcomeReturned,
    stop: () => observer.disconnect(),
  };
}

describe("completed onboarding workspace acceptance", () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    await studioApolloClient().clearStore();
    resetClientRuntime();
  });

  it("[overhaul-386] connects a captured Story to its Details planning step without launching", async () => {
    const boundary = new DurableOnboardingBoundary();
    installBoundary(boundary);
    mountApplication();

    await reachFinalCoachMark("none");

    const handoff = screen.getByRole("dialog", {
      name: "Your first story is ready",
    });
    expect(handoff).toHaveTextContent(/Capturing this Story saved your work/i);
    expect(handoff).toHaveTextContent(/did not start an agent/i);
    expect(handoff).toHaveTextContent(/Details.*desired result.*finished/i);
    await expectSelectedOnboardingStory();
    expect(boundary.acknowledgementAttempts).toBe(0);
    expectCreatedContentOnce(boundary);
    expect(boundary.linkedFolder).toBe("/repos/ticketry");
    expectNoLaunchOperations(boundary);
  });

  it.each([
    ["zero providers", "none"],
    ["selected Codex without a stage binding", "codex"],
  ] as const)(
    "[overhaul-387] offers %s a useful handoff and optional shared guide without acknowledging or launching",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      mountApplication();

      await reachFinalCoachMark(choice);
      const handoff = screen.getByRole("dialog", {
        name: "Your first story is ready",
      });
      expect(handoff).toHaveTextContent(/Details.*desired result.*finished/i);
      if (choice === "none") {
        expect(handoff).toHaveTextContent(/keep editing and organizing/i);
        expect(handoff).toHaveTextContent(/Settings.*Model configuration/i);
      } else {
        expect(handoff).toHaveTextContent(/launch configuration/i);
        expect(handoff).not.toHaveTextContent(/Run now/i);
      }

      fireEvent.click(within(handoff).getByRole("button", {
        name: "Story workflow guide",
      }));
      const guide = await screen.findByRole("dialog", {
        name: "Story workflow guide",
      });
      expect(screen.queryByRole("dialog", {
        name: "Your first story is ready",
      })).not.toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(guide).toHaveTextContent(/Details.*desired result.*finished/i);
      expect(guide).toHaveTextContent(/Finding results/);
      expect(useOnboardingTourStore.getState().step).toBe("handoff");
      expect(boundary.acknowledgementAttempts).toBe(0);
      await expectSelectedOnboardingStory();
      expectNoLaunchOperations(boundary);

      fireEvent.click(within(guide).getByRole("button", { name: "Close" }));
      const restored = await screen.findByRole("dialog", {
        name: "Your first story is ready",
      });
      await waitFor(() => expect(within(restored).getByRole("button", {
        name: "Story workflow guide",
      })).toHaveFocus());
      expect(within(restored).getByRole("button", { name: "Finish tour" }))
        .toBeEnabled();
      expect(boundary.providerChoice).toBe(choice);
      expect(boundary.acknowledgementAttempts).toBe(0);
      expect(boundary.operations.filter((operation) =>
        operation === "UpdateProviderCatalog"
      )).toHaveLength(1);
      expectCreatedContentOnce(boundary);
      expect(boundary.linkedFolder).toBe("/repos/ticketry");
      expectNoLaunchOperations(boundary);
    },
  );

  it("[overhaul-390] explains a configured current-stage Run item without promising launch readiness", async () => {
    const boundary = new DurableOnboardingBoundary();
    boundary.currentStageBinding = true;
    installBoundary(boundary);
    mountApplication();

    await reachFinalCoachMark("codex");
    const handoff = screen.getByRole("dialog", {
      name: "Your first story is ready",
    });
    await waitFor(() => {
      expect(handoff).toHaveTextContent(/Run item starts configured work.*current stage/i);
    });
    expect(handoff).toHaveTextContent(/launch binding is configured/i);
    expect(handoff).toHaveTextContent(/executable.*login.*profile.*backend checks/i);
    expect(handoff).not.toHaveTextContent(/Run now/i);
    expect(boundary.providerChoice).toBe("codex");
    expect(boundary.acknowledgementAttempts).toBe(0);
    await expectSelectedOnboardingStory();
    expectCreatedContentOnce(boundary);
    expectNoLaunchOperations(boundary);
  });

  it("[overhaul-389] lets Finish tour succeed after optional workflow help fails to load", async () => {
    const boundary = new DurableOnboardingBoundary();
    installBoundary(boundary);
    mountApplication();
    await reachFinalCoachMark("none");

    boundary.failProjectOpen = true;
    const handoff = screen.getByRole("dialog", {
      name: "Your first story is ready",
    });
    fireEvent.click(within(handoff).getByRole("button", {
      name: "Story workflow guide",
    }));
    const guide = await screen.findByRole("dialog", {
      name: "Story workflow guide",
    });
    expect(await within(guide).findByRole("alert")).toHaveTextContent(
      /Workflow configuration could not load/,
    );
    expect(guide).not.toHaveTextContent("Next: Grill");
    expect(boundary.acknowledgementAttempts).toBe(0);
    fireEvent.click(within(guide).getByRole("button", { name: "Close" }));
    boundary.failProjectOpen = false;

    const finish = await screen.findByRole("button", { name: "Finish tour" });
    fireEvent.click(finish);
    await waitFor(() => expect(boundary.onboardingRequired).toBe(false));
    expect(boundary.acknowledgementProjectIds).toEqual([PROJECT_ID]);
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    await expectSelectedOnboardingStory();
    expectCreatedContentOnce(boundary);
    expectNoLaunchOperations(boundary);
  });

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-372] teaches Ticketry and Story capture without creating the example for %s",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      mountApplication();

      const welcome = await screen.findByTestId("onboarding-welcome");
      const providerHeading = await within(welcome).findByRole("heading", {
        name: "Your agents",
      });
      const introduction = within(welcome).getByText(/Ticketry helps you turn ideas into planned work/);
      expect(introduction.compareDocumentPosition(providerHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
      expect(welcome).toHaveTextContent(/run coding agents when you choose/);
      expect(welcome).toHaveTextContent(/review their changes/);
      expect(welcome).toHaveTextContent(/plan without an agent provider/);

      const capture = await reachStoryCoachMark(choice);
      expect(screen.getByText(/A Story describes a change you want to make and why it matters/))
        .toBeVisible();
      expect(screen.getByText(/Add a search box so people can find saved notes/))
        .toBeVisible();
      expect(screen.getByText(/real idea field and press Enter/)).toBeVisible();
      expect(capture).toHaveValue("");
      expect(boundary.createdNames).toEqual(["Onboarding module"]);
      expect(boundary.storyCreated).toBe(false);
      expectNoLaunchOperations(boundary);

      fireEvent.change(capture, { target: { value: "Keep my selected story" } });
      fireEvent.keyDown(capture, { key: "Enter" });
      await screen.findByRole("button", { name: "Finish tour" });
      await expectSelectedOnboardingStory();
      expect(boundary.createdNames).toEqual([
        "Onboarding module",
        "Keep my selected story",
      ]);
      expect(boundary.providerChoice).toBe(choice);
      expectNoLaunchOperations(boundary);
    },
  );

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-388] reopens the same Story guide from Details after %s completion and completed-state bootstrap",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      const firstRun = mountApplication();
      const finish = await reachFinalCoachMark(choice);
      fireEvent.click(finish);
      await waitFor(() => expect(boundary.onboardingRequired).toBe(false));
      firstRun.unmount();
      await studioApolloClient().clearStore();
      resetClientRuntime();
      mountApplication();

      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
      const details = await screen.findByRole("region", { name: "Details" });
      const toolbarGuide = within(details).getByRole("button", {
        name: "Story workflow guide",
      });
      toolbarGuide.focus();
      fireEvent.click(toolbarGuide);
      const guide = await screen.findByRole("dialog", {
        name: "Story workflow guide",
      });
      expect(guide).toHaveTextContent("For Story: Keep my selected story");
      expect(guide).toHaveTextContent(/Details.*desired result.*finished/i);
      expect(boundary.acknowledgementAttempts).toBe(1);
      expectNoLaunchOperations(boundary);
      fireEvent.keyDown(guide, { key: "Escape" });
      await waitFor(() => expect(guide).not.toBeInTheDocument());
      await waitFor(() => expect(toolbarGuide).toHaveFocus());
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);
    },
  );

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-370] keeps the created module and selected Story through %s onboarding completion and reload",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      installBoundary(boundary);
      const firstRun = mountApplication();
      const finish = await reachFinalCoachMark(choice);
      const welcome = watchForWelcome();
      fireEvent.click(finish);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Finish tour" }))
          .not.toBeInTheDocument();
      });
      welcome.stop();
      expect(welcome.returned()).toBe(false);
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      const onboarding = studioApolloClient().readQuery({
        query: WorkTrackerOnboardingDocument,
      });
      expect(onboarding?.projects.nodes).toHaveLength(1);
      expect(onboarding?.projects.nodes[0]).toMatchObject({
        onboarding_required: false,
      });
      expect(compactWorktrackerId(onboarding!.projects.nodes[0].id)).toBe(
        compactWorktrackerId(PROJECT_ID),
      );
      expect(useClientStore.getState()).toMatchObject({
        selectedModuleId: MODULE_ID,
        selectedTaskId: STORY_ID,
      });
      expect(screen.queryByText("Your first story is ready")).not.toBeInTheDocument();

      firstRun.unmount();
      await studioApolloClient().clearStore();
      resetClientRuntime();
      mountApplication();

      expect(await screen.findByRole("treeitem", {
        name: /Keep my selected story/,
      })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => expect(useClientStore.getState()).toMatchObject({
        selectedModuleId: MODULE_ID,
        selectedTaskId: STORY_ID,
      }));
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(screen.queryByText("Add your first module")).not.toBeInTheDocument();
      expect(boundary.providerChoice).toBe(choice);
      expectNoLaunchOperations(boundary);
    },
  );

  it.each([
    ["zero providers", "none"],
    ["selected Codex", "codex"],
  ] as const)(
    "[overhaul-371] keeps the selected Story usable while %s acknowledgement fails once and then succeeds",
    async (_label, choice) => {
      const boundary = new DurableOnboardingBoundary();
      boundary.holdNextAcknowledgement();
      installBoundary(boundary);
      const firstRun = mountApplication();
      const finish = await reachFinalCoachMark(choice);
      const welcome = watchForWelcome();

      fireEvent.click(finish);

      await waitFor(() => expect(boundary.acknowledgementAttempts).toBe(1));
      const finishing = screen.getByRole("button", { name: "Finishing…" });
      expect(finishing).toBeDisabled();
      expect(screen.getByRole("heading", {
        name: "Your first story is ready",
      })).toBeVisible();
      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(boundary.onboardingRequired).toBe(true);
      expect(studioApolloClient().readQuery({
        query: WorkTrackerOnboardingDocument,
      })?.projects.nodes[0]).toMatchObject({ onboarding_required: true });
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);

      fireEvent.click(finishing);
      expect(boundary.acknowledgementAttempts).toBe(1);

      act(() => {
        boundary.rejectHeldAcknowledgement(new Error("Acknowledgement unavailable"));
      });

      expect(await screen.findByTestId("onboarding-step-error")).toHaveTextContent(
        "Acknowledgement unavailable",
      );
      expect(screen.getByRole("button", { name: "Finish tour" })).toBeEnabled();
      expect(useOnboardingTourStore.getState().step).toBe("handoff");
      expect(boundary.onboardingRequired).toBe(true);
      expect(studioApolloClient().readQuery({
        query: WorkTrackerOnboardingDocument,
      })?.projects.nodes[0]).toMatchObject({ onboarding_required: true });
      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);

      fireEvent.click(screen.getByRole("button", { name: "Finish tour" }));

      await waitFor(() => {
        expect(boundary.acknowledgementAttempts).toBe(2);
        expect(screen.queryByRole("button", { name: "Finish tour" }))
          .not.toBeInTheDocument();
      });
      expect(boundary.acknowledgementProjectIds).toEqual([PROJECT_ID, PROJECT_ID]);
      expect(boundary.onboardingRequired).toBe(false);
      expect(boundary.providerChoice).toBe(choice);
      expect(boundary.operations.filter((operation) =>
        operation === "UpdateProviderCatalog"
      )).toHaveLength(1);
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(welcome.returned()).toBe(false);
      welcome.stop();
      await expectSelectedOnboardingStory();
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);

      firstRun.unmount();
      await studioApolloClient().clearStore();
      resetClientRuntime();
      mountApplication();

      await expectSelectedOnboardingStory();
      expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
      expect(screen.queryByText("Add your first module")).not.toBeInTheDocument();
      expect(boundary.providerChoice).toBe(choice);
      expectCreatedContentOnce(boundary);
      expectNoLaunchOperations(boundary);
    },
  );
});
