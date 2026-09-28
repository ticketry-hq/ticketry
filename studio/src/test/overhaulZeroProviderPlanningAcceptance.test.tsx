import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectApi = vi.hoisted(() => ({
  acknowledgeOnboarding: vi.fn(),
  readOnboardingProjects: vi.fn(),
}));
const catalogApi = vi.hoisted(() => ({
  updateProviderCatalog: vi.fn(),
}));
const providerState = vi.hoisted(() => ({
  catalog: {
    activated_providers: [] as string[],
    codex_profiles: ["saved-profile"],
    global_default: null,
  },
}));
const codexCapability = vi.hoisted(() => ({
  agent: "codex",
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: ["gpt-5.6-luna"],
  model_prefixes: [],
  reasoning_levels: ["medium"],
  model_reasoning_levels: { "gpt-5.6-luna": ["medium"] },
}));

vi.mock("../features/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/projects")>()),
  ...projectApi,
}));

vi.mock("../features/studio/lib/defaultProject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/defaultProject")>()),
  resolveDefaultProject: vi.fn(async () => ({
    id: "installation-project",
    name: "Coding",
    slug: "CDN",
    description: "",
  })),
}));

vi.mock("../features/workflows/providerQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/workflows/providerQueries")>()),
  updateProviderCatalog: catalogApi.updateProviderCatalog,
  loadProviderCatalog: async () => providerState.catalog,
  loadProviderCapabilities: async () => providerState.catalog.activated_providers.map(
    (agent) => ({ ...codexCapability, agent }),
  ),
  loadConfigurableProviderCapabilities: async () => [codexCapability],
  getProviderCapabilitiesSnapshot: () => providerState.catalog.activated_providers.map(
    (agent) => ({ ...codexCapability, agent }),
  ),
  useProviderCatalogQuery: () => ({
    data: providerState.catalog,
    isPending: false,
    error: null,
  }),
  useConfigurableProviderCapabilitiesQuery: () => ({
    data: [codexCapability],
    isPending: false,
    error: null,
  }),
}));

import { OnboardingGate } from "../app/onboarding/OnboardingGate";
import OnboardingTour from "../app/onboarding/OnboardingTour";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { StudioFooter } from "../app/shell/StudioFooter";
import { RunItemAction } from "../app/shell/ticket-workspace/selected-ticket/details/NormalRunAction";
import {
  loadOnboardingState,
} from "../app/onboarding/onboardingStore";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { loadProviderCatalog } from "../features/workflows/providerQueries";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import {
  documentOperationName,
  type TypedDocumentNode,
} from "../graphql-foundation/typedDocument";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { studioApolloClient } from "../shared/apollo/client";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";
import { installGraphQlViewerLeases } from "./desktopGraphQlRuntime";
import { fixture, mountStudio, workItem } from "./seam";
import type { ReactNode } from "react";

const onboardingProject = (required: boolean) => ({
  id: "installation-project",
  slug: "CDN",
  name: "Coding",
  onboarding_required: required,
});

function Application({ children }: { children?: ReactNode }) {
  return (
    <OnboardingGate>
      <div>Planning workspace</div>
      <OnboardingTour onSelectStory={vi.fn()} />
      {children}
    </OnboardingGate>
  );
}

describe("zero-provider planning acceptance", () => {
  beforeEach(() => {
    studioApolloClient().cache.reset();
    useOnboardingTourStore.getState().reset();
    useStudioStore.setState({
      selectedProjectId: null,
      selectProject: vi.fn(async (projectId: string) => {
        useStudioStore.setState({ selectedProjectId: projectId });
      }),
    });
    providerState.catalog = {
      activated_providers: [],
      codex_profiles: ["saved-profile"],
      global_default: null,
    };
    catalogApi.updateProviderCatalog.mockReset().mockImplementation(async (value) => {
      providerState.catalog = value;
      return value;
    });
    projectApi.acknowledgeOnboarding.mockReset().mockResolvedValue(
      onboardingProject(false),
    );
    projectApi.readOnboardingProjects.mockReset().mockResolvedValue([
      onboardingProject(true),
    ]);
  });

  it("[overhaul-366] recovers from a refused launch after zero-provider onboarding through Settings and an explicit retry", async () => {
    const task = workItem({ id: "story-1", name: "First planned story" });
    const operations = installGraphQlViewerLeases(async (document) => {
      if (documentOperationName(document) !== "CreateTerminalSession") {
        return {} as never;
      }
      if (providerState.catalog.activated_providers.length === 0) {
        throw new FoundationGraphQlError(
          "unknown",
          "no_activated_providers: No activated providers are configured.",
        );
      }
      return { terminal_session: { agent_run_id: "explicit-retry-run" } } as never;
    });
    // Installing the runtime replaces the Apollo client, so seed after it.
    seedModuleLinks([{ id: "link-1", moduleId: "module-1", path: "/repos/ticketry" }]);
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ toasts: [], workspaces: {}, activeByTask: {} });
    await loadOnboardingState();
    render(
      <Application>
        <RunItemAction task={task} moduleId="module-1" />
        <StudioFooter />
        <ModalHost />
      </Application>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await waitFor(() => {
      expect(useOnboardingTourStore.getState().step).toBe("module-create");
    });
    act(() => useOnboardingTourStore.getState().moduleCreated("module-1"));
    act(() => useOnboardingTourStore.getState().storyCreated(task.id));
    fireEvent.click(screen.getByRole("button", { name: "Finish tour" }));
    await waitFor(() => {
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
    });
    expect(providerState.catalog.activated_providers).toEqual([]);

    const run = screen.getByRole("button", { name: "Run item" });
    fireEvent.click(run);
    await waitFor(() => {
      expect(useClientStore.getState().toasts.some((toast) =>
        toast.kind === "error" && toast.message.includes(
          "To run agent work, activate a provider in Settings > Model configuration. You can keep planning without one.",
        ))).toBe(true);
    });
    expect(useClientStore.getState().workspaces[task.id]?.active).not.toBe("terminal");
    expect(operations.filter((call) => call.operationName === "CreateTerminalSession"))
      .toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const settings = await screen.findByRole("dialog", { name: "Studio settings" });
    const models = await within(settings).findByRole("region", {
      name: "Model configuration",
    });
    fireEvent.click(within(models).getByRole("checkbox", { name: "Activate codex" }));
    fireEvent.change(within(models).getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });
    fireEvent.click(within(settings).getByRole("button", { name: "Save changes" }));
    await within(settings).findByText("Model configuration saved.");
    expect(providerState.catalog).toMatchObject({
      activated_providers: ["codex"],
      global_default: { provider: "codex", model: "gpt-5.6-luna" },
    });
    expect(operations.filter((call) => call.operationName === "CreateTerminalSession"))
      .toHaveLength(1);

    fireEvent.click(within(settings).getByRole("button", { name: "Close dialog" }));
    fireEvent.click(run);
    await waitFor(() => {
      expect(useClientStore.getState().toasts.some((toast) =>
        toast.kind === "success" && toast.message === "Agent run started.",
      )).toBe(true);
    });
    expect(operations.filter((call) => call.operationName === "CreateTerminalSession"))
      .toHaveLength(2);
  });

  it("[overhaul-363] accepts zero providers again after an interrupted tour, then skips and stays complete after restart", async () => {
    await loadOnboardingState();
    const firstRun = render(<Application />);

    expect(screen.getByTestId("onboarding-welcome")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    await waitFor(() => {
      expect(useOnboardingTourStore.getState().step).toBe("module-create");
    });
    expect(catalogApi.updateProviderCatalog).toHaveBeenLastCalledWith({
      activated_providers: [],
      codex_profiles: ["saved-profile"],
      global_default: null,
    });
    expect(screen.getByText("Planning workspace")).toBeVisible();
    firstRun.unmount();

    // A reload before acknowledgement loses the run-local tour, so the welcome
    // returns. The saved empty choice remains a valid way back into the tour.
    useOnboardingTourStore.getState().reset();
    studioApolloClient().cache.reset();
    await loadOnboardingState();
    const resumed = render(<Application />);
    expect(screen.getByTestId("onboarding-welcome")).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await waitFor(() => {
      expect(useOnboardingTourStore.getState().step).toBe("module-create");
    });

    act(() => useOnboardingTourStore.getState().moduleCreated("module-1"));
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => {
      expect(projectApi.acknowledgeOnboarding).toHaveBeenCalledWith(
        "installation-project",
      );
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
    });
    expect(screen.getByText("Planning workspace")).toBeVisible();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    resumed.unmount();

    // A full restart reads the acknowledged project and bypasses the welcome.
    studioApolloClient().cache.reset();
    projectApi.readOnboardingProjects.mockResolvedValue([
      onboardingProject(false),
    ]);
    await loadOnboardingState();
    render(<Application />);
    expect(screen.getByText("Planning workspace")).toBeVisible();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(providerState.catalog).toEqual({
      activated_providers: [],
      codex_profiles: ["saved-profile"],
      global_default: null,
    });
    expect(catalogApi.updateProviderCatalog).toHaveBeenCalledTimes(2);
  });

  it("finishes the guided tour with zero providers and keeps the empty catalog", async () => {
    await loadOnboardingState();
    render(<Application />);

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await waitFor(() => {
      expect(useOnboardingTourStore.getState().step).toBe("module-create");
    });

    act(() => useOnboardingTourStore.getState().moduleCreated("module-1"));
    act(() => useOnboardingTourStore.getState().storyCreated("story-1"));
    fireEvent.click(screen.getByRole("button", { name: "Finish tour" }));

    await waitFor(() => {
      expect(projectApi.acknowledgeOnboarding).toHaveBeenCalledWith(
        "installation-project",
      );
      expect(useOnboardingTourStore.getState().step).toBe("inactive");
    });
    expect(screen.getByText("Planning workspace")).toBeVisible();
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
    expect(providerState.catalog).toEqual({
      activated_providers: [],
      codex_profiles: ["saved-profile"],
      global_default: null,
    });
    expect(catalogApi.updateProviderCatalog).toHaveBeenCalledOnce();
  });

  it("[overhaul-364] creates, reads, and edits a work item with no active provider or launch", async () => {
    const http = fixture();
    const existing = workItem({ id: "existing-story", name: "Existing plan" });
    const created = workItem({
      id: "manual-story",
      key: "MEML-2",
      sequence_id: 2,
      name: "Manual plan",
      rank: "A",
    });
    http.tree("module-1", {
      rootIds: [existing.id],
      children: { [existing.id]: [] },
      order: [existing.id],
    });
    http.workItems([existing]);

    const operations: string[] = [];
    const execute = async <TResult, TVariables>(
      document: TypedDocumentNode<TResult, TVariables>,
      variables: TVariables,
    ): Promise<TResult> => {
      const operation = documentOperationName(document);
      operations.push(operation);
      if (operation === "LoadProviderCatalog") {
        return {
          provider_catalog: {
            __typename: "WorktrackerProviderCatalog",
            configurable_providers: [],
            providers: [],
            agent_models: [],
            reasoning_levels: [],
            codex_profiles: [],
            global_default: null,
          },
        } as TResult;
      }
      if (operation !== "CreateWorkTrackerWorkItem") {
        return http.executeGraphQl(document, variables);
      }

      http.workItems([created]);
      http.tree("module-1", {
        rootIds: [created.id, existing.id],
        children: { [created.id]: [], [existing.id]: [] },
        order: [created.id, existing.id],
      });
      const lookup = await http.executeGraphQl(WorkTrackerWorkItemDocument, {
        id: compactWorktrackerId(created.id),
      });
      return { create_work_item: lookup.work_item.nodes[0] } as TResult;
    };

    mountStudio({ http, graphQlExecute: execute });
    await expect(loadProviderCatalog()).resolves.toMatchObject({
      activated_providers: [],
      global_default: null,
    });

    const stories = await screen.findByRole("region", { name: "Stories" });
    fireEvent.click(await within(stories).findByRole("treeitem", {
      name: /Existing plan/,
    }));
    expect(await within(screen.getByRole("region", { name: "Details" }))
      .findByText("Existing plan")).toBeVisible();

    const capture = within(stories).getByRole("textbox", {
      name: "Capture an idea",
    });
    fireEvent.change(capture, { target: { value: "Manual plan" } });
    fireEvent.keyDown(capture, { key: "Enter" });

    await waitFor(() => expect(capture).toHaveAttribute("aria-busy", "false"));
    const row = await within(stories).findByRole("treeitem", {
      name: /Manual plan/,
    });
    fireEvent.click(row);
    const details = await screen.findByRole("region", { name: "Details" });
    expect(await within(details).findByText("Manual plan")).toBeVisible();

    fireEvent.click(within(details).getByText("Manual plan"));
    const name = within(details).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Revised manual plan" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await http.expectPatch("manual-story", { name: "Revised manual plan" });
    expect(await within(details).findByText("Revised manual plan")).toBeVisible();

    expect(
      screen.queryByRole("dialog", { name: /provider/i }),
    ).not.toBeInTheDocument();
    expect(operations).toContain("CreateWorkTrackerWorkItem");
    expect(operations).toContain("UpdateWorkTrackerWorkItemDetails");
    expect(operations).not.toContain("CreateExecutionGraphRun");
    expect(operations).not.toContain("UpdateExecutionGraphRun");
    expect(operations).not.toContain("RunWorkTrackerWorkItemNow");
  });
});
