import { describe, expect, it, vi } from "vitest";

// CODING-2913: Apollo is the sole owner of the provider catalog. Creating the
// workflow editor store must not fabricate server provider records, or a cold
// Settings open adopts that synthetic empty catalog instead of reading Rust.
// Each case starts from a fresh module registry so the store initializes
// against an empty cache, as it does on a cold application start.
async function freshColdStudio() {
  vi.resetModules();
  const { resetStudioApolloClient } = await import("../shared/apollo/client");
  await resetStudioApolloClient();
  return {
    providerQueries: await import("../features/workflows/providerQueries"),
    workflowEditor: await import("../features/workflows/workflowEditorStore"),
  };
}

const startup = {
  serviceHealth: { state: "ready" as const, service: "backend", message: null, logPointer: null },
  initialNotices: [],
};

const provider = (slug: string, activated: boolean) => ({
  __typename: "WorktrackerProvider",
  id: `p-${slug}`,
  slug,
  activated,
  supports_unattended: true,
});

const savedCatalog = {
  __typename: "ProviderCatalog",
  configurable_providers: [
    provider("claude", true),
    provider("codex", true),
    provider("gemini", false),
  ],
  providers: [provider("claude", true), provider("codex", true)],
  agent_models: [{
    __typename: "WorktrackerAgentmodel",
    id: "m-gpt",
    provider: "p-codex",
    name: "gpt-5.4",
    reasoning_levels: {
      __typename: "WorktrackerAgentmodelreasoninglevelConnection",
      nodes: [{
        __typename: "WorktrackerAgentmodelreasoninglevel",
        id: 1,
        reasoning_level_id: "r-medium",
      }],
    },
  }],
  reasoning_levels: [{ __typename: "WorktrackerReasoninglevel", id: "r-medium", name: "medium" }],
  codex_profiles: [],
  global_default: {
    __typename: "GlobalLaunchDefault",
    provider: "codex",
    profile: null,
    model: "gpt-5.4",
    reasoning: "medium",
  },
};

describe("Provider catalog cold store initialization", () => {
  it("leaves the catalog unread when the workflow editor store initializes", async () => {
    const { providerQueries, workflowEditor } = await freshColdStudio();

    workflowEditor.useWorkflowEditorStore.getState();

    expect(providerQueries.getProviderCapabilitiesSnapshot()).toBeUndefined();
  });

  it("[overhaul-840] cold Settings reads the real catalog, reports a failed read and recovers on reopen", async () => {
    // The runtime starts before the Settings chunk loads; a transport change
    // installs a new Apollo client, so initialize it before the store exists.
    vi.resetModules();
    const { resetStudioApolloClient } = await import("../shared/apollo/client");
    await resetStudioApolloClient();
    const { initializeStudioRuntime } = await import("../runtime");
    const { createBrowserRuntime } = await import("../runtime/browserRuntime");
    const { createDesktopRuntime } = await import("../runtime/desktopRuntime");
    const operations: string[] = [];
    let catalogAvailable = false;
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const { operationName } = JSON.parse(encoded) as { operationName: string };
      operations.push(operationName);
      if (operationName !== "LoadProviderCatalog") return JSON.stringify({ data: null });
      if (!catalogAvailable) throw new Error("Provider catalog read failed.");
      return JSON.stringify({ data: { provider_catalog: savedCatalog } });
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: graphqlExecute,
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }));
    const { fireEvent, render, screen, within } = await import("@testing-library/react");
    const { ModalHost } = await import("../app/modal/ModalHost");
    const { StudioFooterActions } = await import("../app/shell/StudioFooterActions");
    await import("../features/workflows/workflowEditorStore");
    const view = render(<><StudioFooterActions /><ModalHost /></>);
    const openSettings = () =>
      fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    try {
      openSettings();
      let dialog = await screen.findByRole("dialog", { name: "Studio settings" });
      expect(await within(dialog).findByRole("alert")).not.toBeEmptyDOMElement();
      expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
      expect(operations).toContain("LoadProviderCatalog");

      fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
      catalogAvailable = true;
      openSettings();
      dialog = await screen.findByRole("dialog", { name: "Studio settings" });
      expect(await within(dialog).findByRole("combobox", { name: "Agent/provider" }))
        .toHaveValue("codex");
      expect(within(dialog).getByRole("combobox", { name: "Model" })).toHaveValue("gpt-5.4");
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
      expect(operations).not.toContain("UpdateProviderCatalog");
    } finally {
      view.unmount();
      initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    }
  });
});
