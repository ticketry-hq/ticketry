import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect } from "vitest";
import StudioApp from "../app/StudioApp";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { DialogHost } from "../app/shell/DialogHost";
import { useDialogStore } from "../app/shell/dialogStore";
import { useStudioStore } from "../features/projects";
import {
  createBrowserRuntime,
  initializeStudioRuntime,
  type WorkTrackerGraphQlExecute,
} from "../runtime";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";

/**
 * A durable first-run boundary behind the mounted shell: onboarding flag,
 * provider catalog, project catalog and created content survive remounts.
 */
export const PROJECT_ID = "345113f3-2578-4285-aed7-b86eb7c4fd78";
export const MODULE_ID = "12d17fb4-643c-4bf5-a16a-f4e974e175f8";
export const STORY_ID = "7692cc90-fffc-4291-a7ad-946ddb8a07d7";
export const MODULE_TYPE_ID = "20b3aa0b-9de6-4419-a260-a0a0a82fa4a7";
export const STORY_TYPE_ID = "17aa004c-c479-41d3-86fa-928b9398ee31";
export const IDEAS_STATE_ID = "07e7d3c4-5e2a-49d8-bc30-831655b2a2c5";
export const CREATED_AT = "2026-09-23T06:30:00Z";

export type ProviderChoice = "none" | "codex";

const connection = <T,>(nodes: T[]) => ({
  __typename: "Connection",
  nodes,
});

export class DurableOnboardingBoundary {
  /**
   * `reviewed` is Pocock's seeded catalogue; `core` seeds only the structural
   * Module type, so there are no states and no Story type (CODING-2860).
   */
  constructor(readonly catalog: "reviewed" | "core" = "reviewed") {}

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

  private states() {
    return this.catalog === "reviewed" ? [this.state()] : [];
  }

  private moduleRow() {
    return {
      __typename: "WorktrackerIssue",
      id: MODULE_ID,
      name: "Onboarding module",
      rank: "a",
      project_id: PROJECT_ID,
      sequence_id: 1,
      state_revision: 1,
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
      states: connection(this.states()),
      issue_types: connection([
        this.issueType(MODULE_TYPE_ID, "Module", "module"),
        ...(this.catalog === "reviewed" ? [this.issueType(STORY_TYPE_ID, "Story", "task")] : []),
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
        return { states: connection(this.states()) } as never;
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

export function installBoundary(boundary: DurableOnboardingBoundary): void {
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

export function mountApplication() {
  return render(
    <StudioApolloProvider>
      <StudioApp />
      <ModalHost />
      <DialogHost />
    </StudioApolloProvider>,
  );
}

export function resetClientRuntime(): void {
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

/** Walks Welcome and the real Module Manager form up to Create module. */
export async function createFirstModule(choice: ProviderChoice): Promise<void> {
  expect(await screen.findByTestId("onboarding-welcome")).toBeVisible();
  const codex = await screen.findByRole("checkbox", { name: "I use codex" });
  if (choice === "codex") fireEvent.click(codex);
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));

  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = await screen.findByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager.querySelector("header")!).getByRole("button", { name: "New module" }));
  const dialog = await screen.findByRole("form", { name: "Create module" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Module name" }), {
    target: { value: "Onboarding module" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Module folder" }), {
    target: { value: "/repos/ticketry" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create module" }));
}
