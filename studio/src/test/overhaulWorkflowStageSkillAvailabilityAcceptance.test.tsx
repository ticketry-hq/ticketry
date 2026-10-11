import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type {
  SkillAvailabilityCheck,
  SkillAvailabilityRequest,
  SkillAvailabilityResult,
} from "../features/workflows/skillAvailability";
import type {
  IssueType,
  LaunchBindingInput,
  ProviderCapabilities,
  ScopedWorkflowLaunchBinding,
  State,
} from "../shared/api/types";

const issueType = { id: "story", name: "Story" } as IssueType;
const review = { id: "review", name: "Review" } as State;

const codex: ProviderCapabilities = {
  agent: "codex",
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: ["gpt-5.6"],
  model_prefixes: [],
  reasoning_levels: [],
  model_reasoning_levels: { "gpt-5.6": [] },
  supports_unattended: true,
};
const claude: ProviderCapabilities = {
  ...codex,
  agent: "claude",
  model_aliases: ["opus"],
  model_reasoning_levels: { opus: [] },
};

function binding(
  overrides: Partial<ScopedWorkflowLaunchBinding> = {},
): ScopedWorkflowLaunchBinding {
  return {
    state_id: "review",
    prompt: "Review the change.",
    required_skills: [],
    stage_skills: ["Interaction-design", "structure-review"],
    agent: "codex",
    profile: null,
    model: "gpt-5.6",
    reasoning: null,
    auto_start: false,
    subtree_run_enabled: false,
    ...overrides,
  };
}

const ROOTS = ["/module/.agents/skills", "/module/skills", "/home/.codex/skills"];

/** A host that has exactly `installed` for every provider it is asked about. */
function host(installed: string[], provider = "codex"): SkillAvailabilityCheck {
  return vi.fn(async (request: SkillAvailabilityRequest): Promise<SkillAvailabilityResult> => {
    const resolved = request.agent ?? provider;
    return {
      status: "checked",
      code: null,
      message: null,
      provider: resolved,
      searched_roots: ROOTS,
      skills: request.names.map((name) => {
        const match = installed.find((skill) => skill === name)
          ?? installed.find((skill) => skill.toLowerCase() === name.toLowerCase());
        return {
          requested: name,
          status: match ? "available" : "missing",
          installed_name: match ?? null,
          location: match ? `/home/.codex/skills/${match}` : null,
          reason: null,
        };
      }),
    };
  });
}

function renderForm({
  check,
  save = vi.fn().mockResolvedValue(undefined),
  stored = binding(),
  launchDefaultKey,
}: {
  check: SkillAvailabilityCheck;
  save?: (input: LaunchBindingInput) => Promise<unknown>;
  stored?: ScopedWorkflowLaunchBinding;
  launchDefaultKey?: string;
}) {
  const view = render(
    <LaunchConfigurationForm
      binding={stored}
      checkSkillAvailability={check}
      issueType={issueType}
      launchDefaultKey={launchDefaultKey}
      moduleId="module-1"
      providerCapabilities={[codex, claude]}
      save={save}
      state={review}
    />,
  );
  return { save, view };
}

const chip = (name: string) => screen.getByRole("listitem", { name: `Skill ${name}` });

it("[overhaul-793] checks existing Review-stage names on open and names the provider and searched locations", async () => {
  const check = host(["interaction-design"]);
  const { save } = renderForm({ check });

  await waitFor(() =>
    expect(within(chip("Interaction-design")).getByText("Available to codex as interaction-design")).toBeVisible());
  expect(within(chip("structure-review")).getByText("Missing for codex")).toBeVisible();
  expect(check).toHaveBeenCalledWith({
    moduleId: "module-1",
    agent: "codex",
    profile: null,
    names: ["Interaction-design", "structure-review"],
  });
  const warning = screen.getByRole("status", { name: "Skill availability" });
  expect(warning).toHaveTextContent("codex cannot see structure-review");
  for (const root of ROOTS) expect(warning).toHaveTextContent(root);
  expect(warning).toHaveTextContent("Saving is still allowed");
  expect(save).not.toHaveBeenCalled();
});

it("[overhaul-794] adding and removing names refreshes the status for the current list", async () => {
  const check = host(["interaction-design", "tdd"]);
  renderForm({ check });
  await screen.findByText("Missing for codex");

  const skills = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(skills, { target: { value: "tdd" } });
  fireEvent.keyDown(skills, { key: "Enter" });
  await waitFor(() =>
    expect(within(chip("tdd")).getByText("Available to codex")).toBeVisible());

  fireEvent.click(screen.getByRole("button", { name: 'Remove skill "structure-review"' }));
  await waitFor(() =>
    expect(screen.queryByRole("status", { name: "Skill availability" }))
      .not.toHaveTextContent("structure-review"));
  expect(check).toHaveBeenLastCalledWith(expect.objectContaining({
    names: ["interaction-design", "tdd"],
  }));
});

it("[overhaul-795] Recheck observes a manual installation without writing the binding", async () => {
  const installed = ["interaction-design"];
  const check = vi.fn(async (request: SkillAvailabilityRequest) =>
    (host([...installed]) as (request: SkillAvailabilityRequest) => Promise<SkillAvailabilityResult>)(request));
  const { save } = renderForm({ check });
  await screen.findByText("Missing for codex");

  installed.push("structure-review");
  const recheck = screen.getByRole("button", { name: "Recheck skills" });
  recheck.focus();
  fireEvent.click(recheck);

  await waitFor(() =>
    expect(within(chip("structure-review")).getByText("Available to codex")).toBeVisible());
  expect(check).toHaveBeenCalledTimes(2);
  expect(save).not.toHaveBeenCalled();
});

it("[overhaul-796] changing the provider or the inherited default checks against the new provider", async () => {
  const check = host(["interaction-design"]);
  const { view } = renderForm({ check });
  await screen.findByText("Missing for codex");

  fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
    target: { value: "claude" },
  });
  await waitFor(() =>
    expect(within(chip("structure-review")).getByText("Missing for claude")).toBeVisible());
  expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ agent: "claude" }));

  const callsBefore = (check as ReturnType<typeof vi.fn>).mock.calls.length;
  view.rerender(
    <LaunchConfigurationForm
      binding={binding({ agent: null, model: null })}
      checkSkillAvailability={check}
      issueType={issueType}
      launchDefaultKey="claude::"
      moduleId="module-1"
      providerCapabilities={[codex, claude]}
      save={vi.fn().mockResolvedValue(undefined)}
      state={review}
    />,
  );
  await waitFor(() =>
    expect((check as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore));
});

it("[overhaul-797] a stale response from an earlier provider never replaces the newer result", async () => {
  const pending: Array<(result: SkillAvailabilityResult) => void> = [];
  const check = vi.fn((request: SkillAvailabilityRequest) =>
    new Promise<SkillAvailabilityResult>((resolve) => {
      pending.push(resolve);
      void request;
    }));
  renderForm({ check });
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
    target: { value: "claude" },
  });
  await waitFor(() => expect(check).toHaveBeenCalledTimes(2));

  const result = (provider: string, status: "available" | "missing") => ({
    status: "checked" as const,
    code: null,
    message: null,
    provider,
    searched_roots: ROOTS,
    skills: ["Interaction-design", "structure-review"].map((name) => ({
      requested: name, status, installed_name: status === "available" ? name : null,
      location: null, reason: null,
    })),
  });
  await act(async () => pending[1](result("claude", "missing")));
  await act(async () => pending[0](result("codex", "available")));

  expect(within(chip("structure-review")).getByText("Missing for claude")).toBeVisible();
  expect(screen.queryByText(/Available to codex/)).not.toBeInTheDocument();
});

it("[overhaul-798] an unresolved provider or failed check is shown as not verified, never available", async () => {
  const check = vi.fn(async (request: SkillAvailabilityRequest): Promise<SkillAvailabilityResult> => ({
    status: "unchecked",
    code: "agent_not_configured",
    message: "No agent/provider is selected and no global launch default is configured.",
    provider: null,
    searched_roots: [],
    skills: request.names.map((name) => ({
      requested: name, status: "unchecked", installed_name: null, location: null,
      reason: "No agent/provider is selected and no global launch default is configured.",
    })),
  }));
  renderForm({ check, stored: binding({ agent: null, model: null }) });

  await waitFor(() =>
    expect(within(chip("structure-review")).getByText("Not verified")).toBeVisible());
  expect(within(chip("Interaction-design")).getByText("Not verified")).toBeVisible();
  expect(screen.queryByText(/Available to/)).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Skill availability" }))
    .toHaveTextContent("No agent/provider is selected");

  const failing = vi.fn().mockRejectedValue(new Error("network down"));
  renderForm({ check: failing });
  await waitFor(() => expect(screen.getAllByText("Not verified").length).toBeGreaterThan(2));
});

it("[overhaul-799] the next edit saves case-only matches under the installed spelling, collapses case duplicates and keeps the rest of the binding", async () => {
  const check = host(["interaction-design"]);
  const save = vi.fn().mockResolvedValue(undefined);
  renderForm({
    check,
    save,
    stored: binding({ profile: null, reasoning: null, required_skills: ["tdd"] }),
  });
  await screen.findByText("Available to codex as interaction-design");

  const skills = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(skills, { target: { value: "INTERACTION-DESIGN" } });
  fireEvent.keyDown(skills, { key: "Enter" });
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(skills, { target: { value: "grill-with-docs" } });
  fireEvent.keyDown(skills, { key: "Enter" });

  await waitFor(() => expect(save).toHaveBeenLastCalledWith({
    prompt: "Review the change.",
    required_skills: ["tdd"],
    stage_skills: ["interaction-design", "structure-review", "grill-with-docs"],
    agent: "codex",
    profile: null,
    model: "gpt-5.6",
    reasoning: null,
  }));
});

it("[overhaul-800] a missing skill never blocks the stage-skill save", async () => {
  const check = host([]);
  const save = vi.fn().mockResolvedValue(undefined);
  renderForm({ check, save, stored: binding({ stage_skills: [] }) });

  const skills = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(skills, { target: { value: "structure-review" } });
  fireEvent.keyDown(skills, { key: "Enter" });

  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage_skills: ["structure-review"] }),
  ));
  await waitFor(() =>
    expect(within(chip("structure-review")).getByText("Missing for codex")).toBeVisible());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("[overhaul-801] opening the reachable state panel checks the saved names through the host query and writes nothing", async () => {
  const { StateConfigurationPanel } = await import("../features/workflows/StateConfigurationPanel");
  const { useStudioStore } = await import("../features/projects");
  const { useClientStore } = await import("../state/clientStore");
  const { useWorkflowEditorStore } = await import("../features/workflows/workflowEditorStore");
  const { readWorkflowSettings } = await import("../features/workflows/queries/readTransport");
  const { initializeStudioRuntime } = await import("../runtime");
  const { createBrowserRuntime } = await import("../runtime/browserRuntime");
  const { createDesktopRuntime } = await import("../runtime/desktopRuntime");

  const storyType = {
    id: "story", project: "project-1", name: "Story", level: "task" as const, color: "",
    sort_order: 0, start_state: "review", workflow_revision: 3, is_pathfind: false,
    created_at: "", updated_at: "",
  };
  const reviewState = {
    id: "review", project: "project-1", name: "Review", group: "started", color: "",
    sort_order: 0, is_protected: false, created_at: "", updated_at: "",
  };
  const operations: Array<{ operationName: string; variables: Record<string, unknown> }> = [];
  const graphqlExecute = vi.fn(async (encoded: string) => {
    const request = JSON.parse(encoded) as {
      operationName: string;
      variables: Record<string, unknown>;
    };
    operations.push(request);
    if (request.operationName === "WorkTrackerProjectOpen") {
      return JSON.stringify({ data: {
        __typename: "WorkTrackerProjectOpen",
        project: { __typename: "WorktrackerProjectConnection", nodes: [{
          __typename: "WorktrackerProject", id: "project-1", name: "Project", slug: "PROJECT",
          description: "", created_at: "",
        }] },
        modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
        module_presentations: { __typename: "WorktrackerModulepresentationConnection", nodes: [] },
        states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", ...reviewState }] },
        issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [{
          __typename: "WorktrackerIssuetype", ...storyType,
          transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [] },
          launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [{
            __typename: "WorktrackerLaunchbinding", id: 1, issue_type: "story", state: "review",
            prompt: "Review it.", required_skills: [],
            stage_skills: ["Interaction-design", "structure-review"],
            model: null, reasoning: null, profile: null, auto_start: false,
            subtree_run_enabled: false, created_at: "", updated_at: "",
            state_record: { __typename: "WorktrackerState", id: "review", sort_order: 0 },
          }] },
        }] },
        provider_catalog: {
          __typename: "ProviderCatalog", configurable_providers: [], providers: [],
          agent_models: [], reasoning_levels: [], codex_profiles: [],
          global_default: null,
        },
      } });
    }
    if (request.operationName === "LaunchSkillAvailability") {
      return JSON.stringify({ data: { launch_skill_availability: {
        __typename: "LaunchSkillAvailabilityPayload",
        status: "checked", code: null, message: null, provider: "codex",
        searched_roots: ROOTS,
        skills: [
          { __typename: "LaunchSkillAvailabilityEntry", requested: "Interaction-design",
            status: "available", installed_name: "interaction-design",
            location: "/home/.codex/skills/interaction-design", reason: null },
          { __typename: "LaunchSkillAvailabilityEntry", requested: "structure-review",
            status: "missing", installed_name: null, location: null, reason: null },
        ],
      } } });
    }
    return JSON.stringify({ data: null, errors: [{ message: `Unexpected ${request.operationName}` }] });
  });

  initializeStudioRuntime(await createDesktopRuntime({
    invoke: vi.fn().mockResolvedValue({
      serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
      initialNotices: [],
    }),
    createGraphQlProxy: () => ({
      graphql_execute: graphqlExecute,
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
  try {
    await readWorkflowSettings("project-1", "story");
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({ selectedModuleId: "module-1" });
    useWorkflowEditorStore.setState({
      projectId: "project-1", issueTypes: [storyType], states: [reviewState],
      stateWorkItemCounts: {}, selectedTypeId: "story", stagedStateIds: {}, loading: false,
      action: null, notice: null, error: null, controlErrors: {},
    });

    render(<StateConfigurationPanel state={reviewState} onClose={vi.fn()} />);

    expect(await screen.findByText("Available to codex as interaction-design")).toBeVisible();
    expect(within(chip("structure-review")).getByText("Missing for codex")).toBeVisible();
    expect(operations.find((operation) => operation.operationName === "LaunchSkillAvailability")
      ?.variables).toEqual({
      moduleId: "module-1",
      agent: null,
      profile: null,
      names: ["Interaction-design", "structure-review"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Recheck skills" }));
    await waitFor(() => expect(operations.filter((operation) =>
      operation.operationName === "LaunchSkillAvailability")).toHaveLength(2));
    expect(operations.some((operation) =>
      operation.operationName.startsWith("Upsert"))).toBe(false);
  } finally {
    useClientStore.setState({ selectedModuleId: null });
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  }
});
