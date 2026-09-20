import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import { upsertIssueTypeWorkflowLaunchBinding } from "../features/workflows/mutationTransport";
import { readWorkflowSettings } from "../features/workflows/queries/readTransport";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import type {
  LaunchBindingInput,
  ScopedWorkflowLaunchBinding,
} from "../shared/api/types";

vi.mock("../features/workflows/providerQueries", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/workflows/providerQueries")>(),
  getCodexProfilesSnapshot: () => ["careful", "fast"],
}));

const startup = {
  serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
  initialNotices: [],
};
const provider = {
  __typename: "WorktrackerProvider", id: "provider-codex", slug: "codex",
  activated: true, supports_unattended: true,
};
const model = {
  __typename: "WorktrackerAgentmodel", id: "model-gpt", provider: provider.id,
  name: "gpt-5.6-luna",
  reasoning_levels: {
    __typename: "WorktrackerAgentmodelreasoninglevelConnection",
    nodes: [{
      __typename: "WorktrackerAgentmodelreasoninglevel",
      id: 1, reasoning_level_id: "reasoning-medium",
    }],
  },
};
const reasoning = {
  __typename: "WorktrackerReasoninglevel", id: "reasoning-medium", name: "medium",
};

/** The row as the host holds it; the upsert handler below rewrites it. */
const row = {
  profile: null as string | null,
  model: model.id as string | null,
  reasoning: reasoning.id as string | null,
};

function catalog() {
  return {
    __typename: "WorkTrackerProjectOpen",
    project: { __typename: "WorktrackerProjectConnection", nodes: [{
      __typename: "WorktrackerProject",
      id: "project-1", name: "Project", slug: "PROJECT", description: "",
      created_at: "",
    }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
    module_presentations: {
      __typename: "WorktrackerModulepresentationConnection", nodes: [],
    },
    states: { __typename: "WorktrackerStateConnection", nodes: [{
      __typename: "WorktrackerState",
      id: "build", project: "project-1", name: "Build", group: "started",
      color: "", sort_order: 0, is_protected: false,
      created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
    }] },
    issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [{
      __typename: "WorktrackerIssuetype",
      id: "story", project: "project-1", name: "Story", level: "task",
      color: "", sort_order: 0, start_state: "build", workflow_revision: 8,
      is_pathfind: false,
      created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
      transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [] },
      launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [{
        __typename: "WorktrackerLaunchbinding",
        id: 1, issue_type: "story", state: "build", prompt: "Implement it.",
        required_skills: [], stage_skills: [],
        profile: row.profile, model: row.model, reasoning: row.reasoning,
        auto_start: false, subtree_run_enabled: false,
        created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
        state_record: { __typename: "WorktrackerState", id: "build", sort_order: 0 },
      }] },
    }] },
    provider_catalog: {
      __typename: "ProviderCatalog",
      configurable_providers: [provider], providers: [provider],
      agent_models: [model], reasoning_levels: [reasoning],
      codex_profiles: ["careful", "fast"],
      global_default: {
        __typename: "GlobalLaunchDefault",
        provider: "codex", model: model.name, reasoning: "medium",
      },
    },
  };
}

afterEach(() => {
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

it("[overhaul-298] saves, reloads, replaces, and clears a workflow Codex profile", async () => {
  const writes: Record<string, unknown>[] = [];
  const graphqlExecute = vi.fn(async (encoded: string) => {
    const request = JSON.parse(encoded) as {
      operationName: string;
      variables: Record<string, unknown>;
    };
    if (request.operationName === "WorkTrackerProjectOpen") {
      return JSON.stringify({ data: catalog() });
    }
    if (request.operationName === "UpsertWorkTrackerLaunchBinding") {
      writes.push(request.variables);
      row.profile = (request.variables.profile as string | null) ?? null;
      row.model = (request.variables.modelId as string | null) ?? null;
      row.reasoning = (request.variables.reasoningId as string | null) ?? null;
      return JSON.stringify({
        data: { upsert_issue_type_launch_binding: { id: 1 } },
      });
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

  // The real transport, not a save stub: it resolves catalog identities and is
  // where a rejected write would be lost.
  const save = (input: LaunchBindingInput) =>
    upsertIssueTypeWorkflowLaunchBinding(
      "project-1", "story", "build", input, 8, false, false,
    );
  /** Whatever the host would serve on the next open. */
  const reload = async (): Promise<ScopedWorkflowLaunchBinding> =>
    (await readWorkflowSettings("project-1", "story", "network-only"))
      .launch_bindings[0];
  const props = {
    issueType: { id: "story", name: "Story" } as never,
    providerCapabilities: [{
      agent: "codex", accepts_model: true, accepts_any_model: false,
      model_aliases: [model.name], reasoning_levels: ["medium"],
    }],
    save,
    state: { id: "build", name: "Build" } as never,
  };

  const open = async (binding: ScopedWorkflowLaunchBinding) =>
    render(<LaunchConfigurationForm {...props} binding={binding} />);
  const chooseProfile = (value: string) =>
    fireEvent.change(screen.getByRole("combobox", { name: "Codex profile" }), {
      target: { value },
    });

  let session = await open(await reload());
  chooseProfile("careful");
  await waitFor(() => expect(writes).toHaveLength(1));
  session.unmount();

  let stored = await reload();
  expect(stored).toMatchObject({ agent: "codex", profile: "careful", model: null });
  session = await open(stored);
  expect(screen.getByRole("combobox", { name: "Codex profile" }))
    .toHaveValue("careful");
  chooseProfile("fast");
  await waitFor(() => expect(writes).toHaveLength(2));
  session.unmount();

  stored = await reload();
  expect(stored.profile).toBe("fast");
  session = await open(stored);
  // "No profile" clears the persisted selection: the write reaches GraphQL and
  // the authoritative reload comes back as the empty inheriting binding rather
  // than the profile that was just cleared (ticket #1824).
  chooseProfile("");
  await waitFor(() => expect(writes).toHaveLength(3));
  expect(writes[2]).toMatchObject({ profile: null, modelId: null, reasoningId: null });
  session.unmount();

  stored = await reload();
  expect(stored).toMatchObject({ agent: null, profile: null, model: null, reasoning: null });

  await open({ ...stored, agent: "codex", profile: "removed" });
  expect(screen.getByRole("option", { name: "removed (unregistered)" }))
    .toBeVisible();
});
