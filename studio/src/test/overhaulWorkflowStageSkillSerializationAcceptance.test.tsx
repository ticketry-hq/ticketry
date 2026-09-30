import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useStudioStore } from "../features/projects";
import { StateConfigurationPanel } from "../features/workflows/StateConfigurationPanel";
import { readWorkflowSettings } from "../features/workflows/queries/readTransport";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";

const startup = {
  serviceHealth: {
    state: "ready",
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const issueType = {
  id: "story",
  project: "project-1",
  name: "Story",
  level: "task" as const,
  color: "",
  sort_order: 0,
  start_state: "build",
  workflow_revision: 8,
  is_pathfind: false,
  created_at: "",
  updated_at: "",
};

const state = {
  id: "build",
  project: "project-1",
  name: "Build",
  group: "started",
  color: "",
  sort_order: 0,
  is_protected: false,
  created_at: "",
  updated_at: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function catalog(stageSkills: string[], workflowRevision: number) {
  return {
    __typename: "WorkTrackerProjectOpen",
    project: {
      __typename: "WorktrackerProjectConnection",
      nodes: [{
        __typename: "WorktrackerProject",
        id: "project-1",
        name: "Project",
        slug: "PROJECT",
        description: "",
        created_at: "",
      }],
    },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
    module_presentations: {
      __typename: "WorktrackerModulepresentationConnection",
      nodes: [],
    },
    states: {
      __typename: "WorktrackerStateConnection",
      nodes: [{ __typename: "WorktrackerState", ...state }],
    },
    issue_types: {
      __typename: "WorktrackerIssuetypeConnection",
      nodes: [{
        __typename: "WorktrackerIssuetype",
        ...issueType,
        workflow_revision: workflowRevision,
        transitions: {
          __typename: "WorktrackerIssuetypetransitionConnection",
          nodes: [],
        },
        launch_bindings: {
          __typename: "WorktrackerLaunchbindingConnection",
          nodes: [{
            __typename: "WorktrackerLaunchbinding",
            id: 1,
            issue_type: "story",
            state: "build",
            prompt: "Implement it.",
            required_skills: [],
            stage_skills: stageSkills,
            model: null,
            reasoning: null,
            profile: null,
            auto_start: false,
            subtree_run_enabled: false,
            created_at: "",
            updated_at: "",
            state_record: {
              __typename: "WorktrackerState",
              id: "build",
              sort_order: 0,
            },
          }],
        },
      }],
    },
    provider_catalog: {
      __typename: "ProviderCatalog",
      configurable_providers: [],
      providers: [],
      agent_models: [],
      reasoning_levels: [],
      codex_profiles: [],
      global_default: null,
    },
  };
}

async function renderRevisionAwareEditor() {
  let serverRevision = 8;
  let serverSkills: string[] = [];
  let holdNextRefresh = false;
  let catalogReads = 0;
  const writes: Record<string, unknown>[] = [];
  const firstMutation = deferred<string>();
  const firstRefresh = deferred<string>();
  const refreshRequested = deferred<void>();

  const graphqlExecute = vi.fn(async (encoded: string) => {
    const request = JSON.parse(encoded) as {
      operationName: string;
      variables: Record<string, unknown>;
    };
    if (request.operationName === "WorkTrackerProjectOpen") {
      catalogReads += 1;
      if (holdNextRefresh) {
        holdNextRefresh = false;
        refreshRequested.resolve();
        return firstRefresh.promise;
      }
      return JSON.stringify({ data: catalog(serverSkills, serverRevision) });
    }
    if (request.operationName !== "UpsertWorkTrackerLaunchBinding") {
      throw new Error(`Unexpected operation ${request.operationName}`);
    }

    writes.push(request.variables);
    if (writes.length === 1) return firstMutation.promise;
    if (request.variables.workflowRevision !== serverRevision) {
      return JSON.stringify({
        data: null,
        errors: [{
          message: "Workflow revision is stale; read the current workflow and retry.",
          extensions: { code: "stale_revision" },
        }],
      });
    }
    serverSkills = request.variables.stageSkills as string[];
    serverRevision += 1;
    return JSON.stringify({
      data: {
        upsert_issue_type_launch_binding: {
          id: 1,
          profile: null,
          stage_skills: serverSkills,
        },
      },
    });
  });

  initializeStudioRuntime(await createDesktopRuntime({
    invoke: vi.fn().mockResolvedValue(startup),
    createGraphQlProxy: () => ({
      graphql_execute: graphqlExecute,
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
  await readWorkflowSettings("project-1", "story");
  useStudioStore.setState({ selectedProjectId: "project-1" });
  useWorkflowEditorStore.setState({
    projectId: "project-1",
    issueTypes: [issueType],
    states: [state],
    stateWorkItemCounts: {},
    selectedTypeId: "story",
    stagedStateIds: {},
    loading: false,
    action: null,
    notice: null,
    error: null,
    controlErrors: {},
  });

  const view = render(<StateConfigurationPanel state={state} onClose={vi.fn()} />);
  await screen.findByRole("textbox", { name: "Skills" });
  await waitFor(() => expect(catalogReads).toBeGreaterThan(1));

  return {
    view,
    writes,
    releaseFirstSave: async (skills: string[]) => {
      serverSkills = skills;
      serverRevision = 9;
      holdNextRefresh = true;
      firstMutation.resolve(JSON.stringify({
        data: {
          upsert_issue_type_launch_binding: {
            id: 1,
            profile: null,
            stage_skills: skills,
          },
        },
      }));
      await refreshRequested.promise;
    },
    releaseFirstRefresh: () => {
      firstRefresh.resolve(JSON.stringify({
        data: catalog(serverSkills, serverRevision),
      }));
    },
  };
}

function addSkill(skill: string) {
  const input = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(input, { target: { value: skill } });
  fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(() => {
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

it("[overhaul-328] serializes rapid stage-skill additions against the refreshed workflow revision", async () => {
  const editor = await renderRevisionAwareEditor();

  addSkill("alpha");
  await waitFor(() => expect(editor.writes).toHaveLength(1));
  addSkill("beta");
  await act(async () => undefined);

  expect(screen.getByText("alpha")).toBeVisible();
  expect(screen.getByText("beta")).toBeVisible();
  expect(editor.writes).toHaveLength(1);

  await act(async () => editor.releaseFirstSave(["alpha"]));
  expect(editor.writes).toHaveLength(1);
  act(() => editor.releaseFirstRefresh());

  await waitFor(() => expect(editor.writes).toHaveLength(2));
  expect(editor.writes[1]).toEqual(expect.objectContaining({
    workflowRevision: 9,
    stageSkills: ["alpha", "beta"],
  }));
  await waitFor(() => {
    expect(useWorkflowEditorStore.getState().workflows.story.workflow_revision).toBe(10);
  });

  editor.view.unmount();
  render(<StateConfigurationPanel state={state} onClose={vi.fn()} />);
  expect(await screen.findByText("alpha")).toBeVisible();
  expect(screen.getByText("beta")).toBeVisible();
});

it("[overhaul-329] serializes a rapid stage-skill removal against the refreshed workflow revision", async () => {
  const editor = await renderRevisionAwareEditor();

  addSkill("alpha");
  await waitFor(() => expect(editor.writes).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: 'Remove skill "alpha"' }));
  await act(async () => undefined);

  expect(screen.getByLabelText("Selected skills")).toBeEmptyDOMElement();
  expect(editor.writes).toHaveLength(1);

  await act(async () => editor.releaseFirstSave(["alpha"]));
  expect(editor.writes).toHaveLength(1);
  act(() => editor.releaseFirstRefresh());

  await waitFor(() => expect(editor.writes).toHaveLength(2));
  expect(editor.writes[1]).toEqual(expect.objectContaining({
    workflowRevision: 9,
    stageSkills: [],
  }));
  await waitFor(() => {
    expect(useWorkflowEditorStore.getState().workflows.story.workflow_revision).toBe(10);
  });

  editor.view.unmount();
  render(<StateConfigurationPanel state={state} onClose={vi.fn()} />);
  await screen.findByRole("textbox", { name: "Skills" });
  expect(screen.getByLabelText("Selected skills")).toBeEmptyDOMElement();
});
