import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import type { WorkTrackerProjectOpenQuery } from "../features/projects";
import { WorkTrackerProjectOpenDocument } from "../features/projects";
import { LoadProviderCatalogDocument } from "../features/settings/generated/providerCatalog.documents";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";
import { TEMP_TASK_ID } from "../features/agents/types";
import { fixture, mountStudio, workItem } from "./seam";

interface Stage {
  id: string;
  name: string;
  group?: string;
}

interface Binding {
  state: string;
  prompt?: string | null;
  autoStart?: boolean;
}

interface WorkflowScenario {
  stages: Stage[];
  start: string;
  edges: Array<[string, string]>;
  bindings?: Binding[];
  activatedProviders?: string[];
  hasDefault?: boolean;
  revision?: number;
}

function storyFixture(scenario?: WorkflowScenario) {
  const http = fixture();
  http.tree("module-1", {
    rootIds: ["story-1", "story-2"],
    children: { "story-1": [], "story-2": [] },
    order: ["story-1", "story-2"],
  });
  http.workItems([
    workItem({
      id: "story-1",
      name: "Search saved notes",
      state: { id: "ideas", name: "Ideas", group: "backlog", color: null },
      issue_type: {
        id: "story", name: "Story", level: "task", color: null,
        sort_order: 1, start_state: scenario?.start ?? "ideas",
        workflow_revision: scenario?.revision ?? 1,
      },
    }),
    workItem({
      id: "story-2",
      name: "Export saved notes",
      key: "MEML-2",
      sequence_id: 2,
      rank: "b",
      state: { id: "review", name: "Review", group: "started", color: null },
    }),
  ]);
  if (scenario) {
    http.workItems(scenario.stages.map((stage, index) => workItem({
      id: `catalog-${stage.id}`,
      name: `Catalog ${stage.name}`,
      sequence_id: index + 100,
      state: {
        id: stage.id,
        name: stage.name,
        group: stage.group ?? "started",
        color: null,
        sort_order: index,
      },
      issue_type: "catalog-only",
    })));
  }
  let current = scenario;
  let failProjectOpen = false;
  let heldProjectOpen: Promise<void> | null = null;
  const graphQlOperations: string[] = [];
  const providerRows = (value: WorkflowScenario) =>
    (value.activatedProviders ?? []).map((slug) => ({
      __typename: "WorktrackerProvider",
      id: slug,
      slug,
      activated: true,
      supports_unattended: false,
    }));
  const catalog = (base: WorkTrackerProjectOpenQuery["provider_catalog"], value: WorkflowScenario) => ({
    ...base,
    configurable_providers: providerRows(value),
    providers: providerRows(value),
    global_default: value.hasDefault ? {
      __typename: "WorktrackerLaunchDefault",
      provider: "codex", profile: null, model: null, reasoning: null,
    } : null,
  });
  const execute: typeof http.executeGraphQl = async (document, variables) => {
    const operation = documentOperationName(document);
    graphQlOperations.push(operation);
    if (operation === "WorkTrackerProjectOpen" && heldProjectOpen) {
      const pending = heldProjectOpen;
      heldProjectOpen = null;
      await pending;
    }
    const result = await http.executeGraphQl(document, variables);
    if (!current) return result;
    if (operation === "WorkTrackerProjectOpen" && failProjectOpen) {
      failProjectOpen = false;
      throw new FoundationGraphQlError(
        "worktracker_read_failed",
        "Workflow read failed.",
      );
    }
    if (operation === "LoadProviderCatalog") {
      const response = result as unknown as { provider_catalog: WorkTrackerProjectOpenQuery["provider_catalog"] };
      return {
        provider_catalog: catalog(response.provider_catalog, current),
      } as typeof result;
    }
    if (operation !== "WorkTrackerProjectOpen") return result;
    const response = result as unknown as WorkTrackerProjectOpenQuery;
    const type = response.issue_types.nodes.find((item) => item.id === "story")!;
    const stateTemplate = response.states.nodes[0]!;
    const bindingTemplate = type.launch_bindings.nodes[0]!;
    return {
      ...response,
      states: {
        ...response.states,
        nodes: current.stages.map((stage, index) => ({
          ...stateTemplate,
          id: stage.id,
          name: stage.name,
          group: stage.group ?? "started",
          sort_order: index,
        })),
      },
      issue_types: {
        ...response.issue_types,
        nodes: response.issue_types.nodes.map((item) => item.id === "story" ? {
          ...item,
          start_state: current!.start,
          workflow_revision: current!.revision ?? 1,
          transitions: {
            ...item.transitions,
            nodes: current!.edges.map(([from, to], index) => ({
              __typename: "WorktrackerIssuetypetransition",
              id: index + 1,
              issue_type: "story",
              from_state: from,
              to_state: to,
              agent_allowed: true,
              handoff: index === 0,
              fromState: { __typename: "WorktrackerState", id: from, sort_order: current!.stages.findIndex((stage) => stage.id === from) },
              toState: { __typename: "WorktrackerState", id: to, sort_order: current!.stages.findIndex((stage) => stage.id === to) },
            })),
          },
          launch_bindings: {
            ...item.launch_bindings,
            nodes: (current!.bindings ?? []).map((binding, index) => ({
              ...bindingTemplate,
              id: index + 1,
              issue_type: "story",
              state: binding.state,
              state_record: {
                __typename: "WorktrackerState",
                id: binding.state,
                sort_order: current!.stages.findIndex((stage) => stage.id === binding.state),
              },
              prompt: binding.prompt ?? null,
              auto_start: binding.autoStart ?? false,
            })),
          },
        } : item),
      },
      provider_catalog: catalog(response.provider_catalog, current),
    } as typeof result;
  };
  const mount = (selectedTaskId = "story-1") => mountStudio({
    http,
    selectedTaskId,
    graphQlExecution: true,
    graphQlExecute: execute,
    children: <ModalHost />,
  });
  return {
    http,
    mount,
    graphQlOperations,
    setScenario(value: WorkflowScenario) { current = value; },
    failNextProjectOpen() { failProjectOpen = true; },
    holdNextProjectOpen() {
      let release = () => {};
      heldProjectOpen = new Promise<void>((resolve) => { release = resolve; });
      return release;
    },
  };
}

async function openGuide() {
  const details = await screen.findByRole("region", { name: "Details" });
  const trigger = await within(details).findByRole("button", {
    name: "Story workflow guide",
  });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole("dialog", { name: "Story workflow guide" }) };
}

describe("overhaul acceptance — Story workflow guide", () => {
  beforeEach(async () => {
    await studioApolloClient().cache.reset();
    useModalStore.setState({ modalStack: [] });
  });

  it("[overhaul-373] opens the saved Story's read-only guide from Details", async () => {
    const { http, mount, graphQlOperations } = storyFixture();
    mount();
    const { trigger, dialog } = await openGuide();
    expect(dialog).toBeVisible();
    expect(screen.getAllByText("Search saved notes").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Story workflow guide" })).toBeNull());
    expect(trigger).toHaveFocus();
    expect(http.runNowCount("story-1")).toBe(0);
    expect(http.graphRunCount("story-1")).toBe(0);
    expect((http as unknown as { patches: unknown[] }).patches).toEqual([]);
    expect(graphQlOperations.filter((operation) =>
      /CreateTerminalSession|CreateWorkItem|UpdateWorkItem|AcknowledgeOnboarding|LaunchAgent/.test(operation),
    )).toEqual([]);
  });

  it("[overhaul-374] teaches only configured stages and actual branching destinations", async () => {
    const { http, mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "grill", name: "Grill" },
        { id: "review", name: "Review" },
        { id: "done", name: "Done", group: "completed" },
        { id: "unrelated", name: "Unrelated project state" },
      ],
      start: "ideas",
      edges: [["ideas", "grill"], ["ideas", "review"], ["grill", "review"], ["review", "done"]],
      bindings: [{ state: "grill", prompt: "Ask which saved notes should match." }],
    });
    mount();
    const { dialog } = await openGuide();

    await waitFor(() => expect(dialog).toHaveTextContent("Grill"));
    expect(dialog).toHaveTextContent("Current state");
    expect(dialog).toHaveTextContent("Next: Grill, Review");
    expect(dialog).toHaveTextContent("Done");
    expect(dialog).not.toHaveTextContent("Unrelated project state");
    expect(dialog).not.toHaveTextContent("Tickets");
    expect(dialog).toHaveTextContent("saved notes");
    expect((http as unknown as { patches: unknown[] }).patches).toEqual([]);
  });

  it("[overhaul-375] preserves custom stage names and shows instructions as inert text", async () => {
    const scriptLikePrompt = '<img src=x onerror="window.__unsafeGuidePrompt = true">';
    const { mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "forge", name: "Forge" },
        { id: "review", name: "Review" },
      ],
      start: "ideas",
      edges: [["ideas", "forge"], ["forge", "review"]],
      bindings: [
        { state: "forge", prompt: scriptLikePrompt },
        { state: "review", prompt: "Check accessible search behavior." },
      ],
    });
    mount();
    const { dialog } = await openGuide();

    await waitFor(() => expect(dialog).toHaveTextContent("Forge"));
    expect(dialog).toHaveTextContent("Custom stage. Its configured instructions define what happens here.");
    expect(dialog).not.toHaveTextContent("Grill");
    expect(dialog).not.toHaveTextContent("Tickets");
    fireEvent.click(within(dialog).getAllByText("Stage instructions")[1]!);
    expect(dialog).toHaveTextContent(scriptLikePrompt);
    expect(dialog.querySelector("img")).toBeNull();
    expect((window as unknown as { __unsafeGuidePrompt?: boolean }).__unsafeGuidePrompt)
      .toBeUndefined();
  });

  it("[overhaul-376] marks an out-of-configuration current state without inventing a transition", async () => {
    const { http, mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "review", name: "Review" },
        { id: "parked", name: "Parked" },
      ],
      start: "ideas",
      edges: [["ideas", "review"]],
      bindings: [],
    });
    http.revise("story-1", { state: "parked" });
    mount();
    const { dialog } = await openGuide();

    await waitFor(() => expect(dialog).toHaveTextContent("Parked"));
    expect(dialog).toHaveTextContent("Current state is outside this Story's configured workflow.");
    expect(dialog).toHaveTextContent("No outgoing transitions configured.");
    expect(dialog).not.toHaveTextContent("Grill");
    expect(dialog).not.toHaveTextContent("Tickets");
  });

  it("[overhaul-377] separates provider activation, binding, and entry auto-start", async () => {
    const { mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "review", name: "Review" },
      ],
      start: "ideas",
      edges: [["ideas", "review"]],
      bindings: [{ state: "review", autoStart: true }],
      activatedProviders: ["codex"],
      hasDefault: false,
    });
    mount();
    const { dialog } = await openGuide();

    await waitFor(() => expect(dialog).toHaveTextContent("Entry auto-start: On"));
    expect(dialog).toHaveTextContent("Launch binding: Not configured");
    expect(dialog).toHaveTextContent("Launch binding: Configured");
    expect(dialog).toHaveTextContent("Run item");
    expect(dialog).toHaveTextContent("Run now");
    expect(dialog).toHaveTextContent("Run subtree");
    expect(dialog).toHaveTextContent("+ Agent");
    expect(dialog).toHaveTextContent("Terminal");
    expect(dialog).toHaveTextContent("Changes");
    expect(within(dialog).queryByRole("button", { name: "Run item" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Run now" })).toBeNull();
  });

  it("[overhaul-378] gives a planning-only next step with no provider or launch requirement", async () => {
    const { http, mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "review", name: "Review" },
      ],
      start: "ideas",
      edges: [["ideas", "review"]],
      bindings: [],
      activatedProviders: [],
    });
    mount();
    const { dialog } = await openGuide();

    expect(dialog).toHaveTextContent("describe the desired result and what would count as finished");
    await waitFor(() => expect(dialog).toHaveTextContent("Settings > Model configuration"));
    expect(dialog).toHaveTextContent("Launch binding: Not configured");
    expect(http.runNowCount("story-1")).toBe(0);
    expect(http.graphRunCount("story-1")).toBe(0);
    expect((http as unknown as { patches: unknown[] }).patches).toEqual([]);
  });

  it("[overhaul-379] keeps the guide out of scratch and module-only selections", async () => {
    const { mount } = storyFixture();
    mount();
    await screen.findByRole("region", { name: "Details" });

    act(() => useClientStore.getState().selectTask(TEMP_TASK_ID));
    expect(screen.queryByRole("button", { name: "Story workflow guide" })).toBeNull();
    act(() => useClientStore.setState({ selectedTaskId: null }));
    expect(screen.queryByRole("button", { name: "Story workflow guide" })).toBeNull();
  });

  it("[overhaul-380] contains focus and closes with Escape, restoring the surviving trigger", async () => {
    const { mount } = storyFixture();
    mount();
    const { trigger, dialog } = await openGuide();
    const close = within(dialog).getByRole("button", { name: "Close" });

    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Story workflow guide" })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("[overhaul-381] reports a workflow read failure and retries without teaching fallback stages", async () => {
    const scenario: WorkflowScenario = {
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "forge", name: "Forge" },
      ],
      start: "ideas",
      edges: [["ideas", "forge"]],
      bindings: [],
    };
    const { mount, failNextProjectOpen } = storyFixture(scenario);
    mount();
    await screen.findByRole("button", { name: "Story workflow guide" });
    failNextProjectOpen();
    const { dialog } = await openGuide();

    await waitFor(() => expect(within(dialog).getByRole("alert"))
      .toHaveTextContent("Workflow configuration could not load"));
    expect(dialog).toHaveTextContent("describe the desired result");
    expect(dialog).toHaveTextContent("Run item");
    expect(dialog).not.toHaveTextContent("Grill");
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(dialog).toHaveTextContent("Next: Forge"));
  });

  it("[overhaul-382] follows workflow revisions, Story state, and provider changes while open", async () => {
    const initial: WorkflowScenario = {
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "review", name: "Review" },
      ],
      start: "ideas",
      edges: [["ideas", "review"]],
      bindings: [{ state: "ideas", prompt: "Describe search behavior." }],
      activatedProviders: ["codex"],
      hasDefault: true,
      revision: 1,
    };
    const { http, mount, setScenario } = storyFixture(initial);
    mount();
    const { dialog } = await openGuide();
    await waitFor(() => expect(dialog).toHaveTextContent("Next: Review"));
    expect(dialog).not.toHaveTextContent("Settings > Model configuration");

    setScenario({
      ...initial,
      revision: 2,
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "forge", name: "Forge" },
        { id: "review", name: "Review" },
      ],
      edges: [["ideas", "forge"], ["forge", "review"]],
    });
    await act(async () => {
      await studioApolloClient().query({
        query: WorkTrackerProjectOpenDocument,
        variables: { projectId: "project-1" },
        fetchPolicy: "network-only",
      });
    });
    await waitFor(() => expect(dialog).toHaveTextContent("Next: Forge"));
    expect(within(dialog).getByRole("heading", { name: "Ideas" }).closest("li"))
      .not.toHaveTextContent("Next: Review");

    act(() => {
      const client = studioApolloClient();
      const current = client.readQuery({ query: LoadProviderCatalogDocument })!;
      client.writeQuery({
        query: LoadProviderCatalogDocument,
        data: {
          provider_catalog: {
            ...current.provider_catalog,
            configurable_providers: current.provider_catalog.configurable_providers.map(
              (provider) => ({ ...provider, activated: false }),
            ),
            global_default: null,
          },
        },
      });
    });
    await waitFor(() => expect(dialog).toHaveTextContent("Settings > Model configuration"));

    http.revise("story-1", { state: "review" });
    act(() => http.notifications.workItemChanged("story-1", 100));
    const reviewHeading = await within(dialog).findByRole("heading", { name: "Review" });
    await waitFor(() => expect(reviewHeading.closest("li")).toHaveTextContent("Current state"));
  });

  it("[overhaul-383] discards the prior Story on selection switch and closes on deletion", async () => {
    const { mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "review", name: "Review" },
      ],
      start: "ideas",
      edges: [["ideas", "review"]],
      bindings: [],
    });
    mount();
    const first = await openGuide();
    await waitFor(() => expect(first.dialog).toHaveTextContent("Current state"));

    act(() => useClientStore.getState().selectTask("story-2"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Story workflow guide" })).toBeNull());
    const second = await openGuide();
    const reviewHeading = await within(second.dialog).findByRole("heading", { name: "Review" });
    expect(reviewHeading.closest("li")).toHaveTextContent("Current state");
    const ideasHeading = within(second.dialog).getByRole("heading", { name: "Ideas" });
    expect(ideasHeading.closest("li")).not.toHaveTextContent("Current state");

    act(() => {
      const cache = studioApolloClient().cache;
      cache.evict({ id: cache.identify({ __typename: "WorktrackerIssue", id: "story-2" }) });
      cache.gc();
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Story workflow guide" })).toBeNull());
  });

  it("[overhaul-384] treats renamed familiar stages as custom and exposes empty instructions", async () => {
    const { mount } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "review", name: "Verify" },
      ],
      start: "ideas",
      edges: [["ideas", "review"]],
      bindings: [],
    });
    mount();
    const { dialog } = await openGuide();
    const renamed = await within(dialog).findByRole("heading", { name: "Verify" });
    expect(renamed.closest("li")).toHaveTextContent(
      "Custom stage. Its configured instructions define what happens here.",
    );
    expect(renamed.closest("li")).not.toHaveTextContent("inspects the result");
    fireEvent.click(within(renamed.closest("li")!).getByText("Stage instructions"));
    expect(renamed.closest("li")).toHaveTextContent("No agent instructions configured.");
  });

  it("[overhaul-385] keeps generic guidance while workflow details load", async () => {
    const { mount, holdNextProjectOpen } = storyFixture({
      stages: [
        { id: "ideas", name: "Ideas", group: "backlog" },
        { id: "forge", name: "Forge" },
      ],
      start: "ideas",
      edges: [["ideas", "forge"]],
      bindings: [],
    });
    mount();
    const trigger = await screen.findByRole("button", { name: "Story workflow guide" });
    const release = holdNextProjectOpen();
    act(() => {
      studioApolloClient().cache.evict({ id: "ROOT_QUERY", fieldName: "worktrackerProject" });
      studioApolloClient().cache.gc();
      fireEvent.click(trigger);
    });
    const dialog = await screen.findByRole("dialog", { name: "Story workflow guide" });

    expect(await within(dialog).findByRole("status")).toHaveTextContent("Loading workflow");
    expect(dialog).toHaveTextContent("describe the desired result");
    expect(dialog).toHaveTextContent("Run item");
    expect(dialog).not.toHaveTextContent("Grill");
    release();
    await waitFor(() => expect(dialog).toHaveTextContent("Next: Forge"));
  });
});
