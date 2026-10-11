import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    required_skills: ["grill-with-docs"],
    stage_skills: ["Interaction-design"],
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

const chip = (name: string) => screen.getByRole("listitem", { name: `Required skill ${name}` });

it("[overhaul-802] existing required skills show their provider and searched locations without rewriting old bindings", async () => {
  const check = host(["interaction-design"]);
  const { save } = renderForm({ check });

  expect(screen.getByRole("textbox", { name: "Required skills" })).toBeVisible();
  await waitFor(() =>
    expect(within(chip("grill-with-docs")).getByText("Missing for codex")).toBeVisible());
  expect(check).toHaveBeenCalledWith({
    moduleId: "module-1", agent: "codex", profile: null, names: ["grill-with-docs"],
  });
  const warning = screen.getByRole("status", { name: "Required skill availability" });
  expect(warning).toHaveTextContent("codex cannot see grill-with-docs");
  for (const root of ROOTS) expect(warning).toHaveTextContent(root);
  expect(screen.getByRole("button", { name: "Recheck required skills" })).toBeVisible();
  expect(save).not.toHaveBeenCalled();
});

function addSkill(field: "Skills" | "Required skills", name: string) {
  const input = screen.getByRole("textbox", { name: field });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

it("[overhaul-803] required edits save and reload while preserving stage skills and unrelated binding fields", async () => {
  const check = host(["interaction-design", "tdd"]);
  let stored = binding({ auto_start: true, subtree_run_enabled: true });
  const save = vi.fn(async (input: LaunchBindingInput) => {
    stored = {
      ...stored, ...input, prompt: input.prompt ?? stored.prompt,
      required_skills: input.required_skills ?? stored.required_skills,
      stage_skills: input.stage_skills ?? stored.stage_skills,
    };
  });
  const { view } = renderForm({ check, stored, save });
  await waitFor(() => expect(within(chip("grill-with-docs")).getByText("Missing for codex")).toBeVisible());

  addSkill("Required skills", "tdd");
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    prompt: "Review the change.", required_skills: ["grill-with-docs", "tdd"],
    stage_skills: ["Interaction-design"], agent: "codex", profile: null,
    model: "gpt-5.6", reasoning: null,
  }));
  view.unmount();
  renderForm({ check, stored, save });
  expect(chip("tdd")).toBeVisible();
  expect(screen.getByRole("listitem", { name: "Skill Interaction-design" })).toBeVisible();
  expect(stored.auto_start).toBe(true);
  expect(stored.subtree_run_enabled).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
});

it("[overhaul-804] stage edits preserve catalog spelling for required skills despite case-only installed matches", async () => {
  const check = host(["GRILL-WITH-DOCS", "interaction-design", "structure-review"]);
  const save = vi.fn().mockResolvedValue(undefined);
  const { view } = renderForm({ check, save });
  await waitFor(() => expect(within(chip("grill-with-docs"))
    .getByText("Available to codex as GRILL-WITH-DOCS")).toBeVisible());
  expect(save).not.toHaveBeenCalled();

  addSkill("Skills", "structure-review");
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    prompt: "Review the change.", required_skills: ["grill-with-docs"],
    stage_skills: ["interaction-design", "structure-review"], agent: "codex",
    profile: null, model: "gpt-5.6", reasoning: null,
  }));
  const saved = save.mock.calls[0][0] as LaunchBindingInput;
  view.unmount();
  renderForm({ check, save, stored: binding({
    ...saved, prompt: saved.prompt ?? "Review the change.",
    required_skills: saved.required_skills ?? [], stage_skills: saved.stage_skills ?? [],
  }) });
  expect(chip("grill-with-docs")).toBeVisible();
  expect(screen.queryByRole("listitem", { name: "Required skill GRILL-WITH-DOCS" })).toBeNull();
  expect(save).toHaveBeenCalledTimes(1);
});


it("[overhaul-805] an installed skill outside the required catalog still displays the server save rejection", async () => {
  const check = host(["interaction-design"]);
  const save = vi.fn().mockRejectedValue(new Error("invalid_required_skills: Required skill 'interaction-design' is invalid or duplicated."));
  function ServerValidatedForm() {
    const [error, setError] = useState<string>();
    return <LaunchConfigurationForm
      binding={binding({ required_skills: [], stage_skills: [] })}
      checkSkillAvailability={check} error={error} issueType={issueType}
      moduleId="module-1" providerCapabilities={[codex, claude]} state={review}
      save={async (input) => {
        try { return await save(input); }
        catch (failure) { setError((failure as Error).message); return null; }
      }}
    />;
  }
  render(<ServerValidatedForm />);
  addSkill("Required skills", "interaction-design");
  await waitFor(() => expect(within(chip("interaction-design")).getByText("Available to codex")).toBeVisible());
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid_required_skills");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ required_skills: ["interaction-design"] }));
});

it("[overhaul-806] provider changes recheck required names for the selected provider", async () => {
  const check = host([]);
  renderForm({ check });
  await waitFor(() => expect(within(chip("grill-with-docs")).getByText("Missing for codex")).toBeVisible());
  fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), { target: { value: "claude" } });
  await waitFor(() => expect(within(chip("grill-with-docs")).getByText("Missing for claude")).toBeVisible());
  expect(check).toHaveBeenCalledWith(expect.objectContaining({ agent: "claude", names: ["grill-with-docs"] }));
  expect(screen.getByRole("status", { name: "Required skill availability" })).toHaveTextContent("claude cannot see grill-with-docs");
});

it("[overhaul-807] keyboard-reachable required Recheck observes manual installation without saving", async () => {
  const installed: string[] = [];
  const check = vi.fn(async (request: SkillAvailabilityRequest) =>
    (host(installed) as (request: SkillAvailabilityRequest) => Promise<SkillAvailabilityResult>)(request));
  const { save } = renderForm({ check });
  await waitFor(() => expect(within(chip("grill-with-docs")).getByText("Missing for codex")).toBeVisible());
  installed.push("grill-with-docs");
  const recheck = screen.getByRole("button", { name: "Recheck required skills" });
  recheck.focus();
  expect(recheck).toHaveFocus();
  fireEvent.click(recheck);
  await waitFor(() => expect(within(chip("grill-with-docs")).getByText("Available to codex")).toBeVisible());
  expect(check.mock.calls.filter(([request]) => request.names.includes("grill-with-docs"))).toHaveLength(2);
  expect(save).not.toHaveBeenCalled();
});
it("[overhaul-808] reachable state configuration checks required names and Recheck uses only read operations", async () => {
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
            prompt: "Review it.", required_skills: ["grill-with-docs"],
            stage_skills: [],
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
        skills: (request.variables.names as string[]).map((requested) => ({
          __typename: "LaunchSkillAvailabilityEntry", requested,
          status: "missing", installed_name: null, location: null, reason: null,
        })),
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

    await waitFor(() => expect(within(chip("grill-with-docs")).getByText("Missing for codex")).toBeVisible());
    expect(operations.find((operation) => operation.operationName === "LaunchSkillAvailability")
      ?.variables).toEqual({
      moduleId: "module-1",
      agent: null,
      profile: null,
      names: ["grill-with-docs"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Recheck required skills" }));
    await waitFor(() => expect(operations.filter((operation) =>
      operation.operationName === "LaunchSkillAvailability")).toHaveLength(2));
    expect(operations.every((operation) => ["WorkTrackerProjectOpen", "LaunchSkillAvailability"].includes(operation.operationName))).toBe(true);
  } finally {
    useClientStore.setState({ selectedModuleId: null });
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  }
}, 15_000);
