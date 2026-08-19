import { createRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelConfigurationPanel,
  type ModelConfigurationPanelHandle,
  useActivatedProviders,
} from "../features/workflows";
import { queryClient } from "../shared/query/queryClient";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";

const startup = {
  endpoints: {
    workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
    agentApi: "http://127.0.0.1:8787/api",
    statusApi: "http://127.0.0.1:8787/api",
    terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
  },
  values: { workTrackerApiKey: "" },
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const allProviders = [
  { id: "p-claude", slug: "claude", activated: true, supports_unattended: true },
  { id: "p-codex", slug: "codex", activated: true, supports_unattended: true },
  { id: "p-gemini", slug: "gemini", activated: false, supports_unattended: true },
];

function payload(activated: readonly string[]) {
  return {
    configurable_providers: allProviders.map((provider) => ({
      ...provider,
      activated: activated.includes(provider.slug),
    })),
    providers: allProviders
      .filter((provider) => activated.includes(provider.slug))
      .map((provider) => ({ ...provider, activated: true })),
    agent_models: [
      {
        id: "m-sonnet",
        provider: "p-claude",
        name: "sonnet",
        reasoning_levels: { nodes: [{ reasoning_level_id: "r-high" }] },
      },
      {
        id: "m-gpt",
        provider: "p-codex",
        name: "gpt-5.6-luna",
        reasoning_levels: { nodes: [{ reasoning_level_id: "r-high" }] },
      },
      {
        id: "m-gemini",
        provider: "p-gemini",
        name: "gemini-pro",
        reasoning_levels: { nodes: [{ reasoning_level_id: "r-high" }] },
      },
    ],
    reasoning_levels: [{ id: "r-high", name: "high" }],
    global_default: {
      provider: activated.includes("gemini") ? "gemini" : "codex",
      model: activated.includes("gemini") ? "gemini-pro" : "gpt-5.6-luna",
      reasoning: "high",
    },
  };
}

function PickerProbe() {
  const providers = useActivatedProviders();
  return (
    <output aria-label="Launch picker providers">
      {[...providers.slugs].sort().join(",")}
    </output>
  );
}

describe("provider catalogue desktop runtime acceptance", () => {
  afterEach(() => {
    queryClient.removeQueries();
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    vi.unstubAllGlobals();
  });

  it("[overhaul-79] atomically saves GraphQL catalogue changes and converges launch pickers immediately", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const operations: string[] = [];
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const request = JSON.parse(encoded) as {
        operationName: string;
        variables: {
          activatedProviders?: string[];
          defaultProvider?: string | null;
          defaultModel?: string | null;
          defaultReasoning?: string | null;
        };
      };
      operations.push(request.operationName);
      if (request.operationName === "LoadProviderCatalog") {
        return JSON.stringify({ data: { provider_catalog: payload(["claude", "codex"]) } });
      }
      expect(request.operationName).toBe("UpdateProviderCatalog");
      expect(request.variables).toEqual({
        activatedProviders: ["claude", "codex", "gemini"],
        defaultProvider: "gemini",
        defaultModel: "gemini-pro",
        defaultReasoning: "high",
      });
      return JSON.stringify({
        data: {
          update_provider_catalog: payload(request.variables.activatedProviders ?? []),
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
    queryClient.removeQueries();

    const panel = createRef<ModelConfigurationPanelHandle>();
    render(
      <>
        <ModelConfigurationPanel ref={panel} />
        <button type="button" onClick={() => panel.current?.save()}>Save</button>
        <PickerProbe />
      </>,
    );

    const region = await screen.findByRole("region", { name: "Model configuration" });
    expect(screen.getByRole("status", { name: "Launch picker providers" }))
      .toHaveTextContent("claude,codex");
    fireEvent.click(within(region).getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.change(within(region).getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "gemini" },
    });
    fireEvent.change(within(region).getByLabelText("Model"), {
      target: { value: "gemini-pro" },
    });
    fireEvent.change(within(region).getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Launch picker providers" }))
        .toHaveTextContent("claude,codex,gemini");
    });
    expect(operations).toEqual(["LoadProviderCatalog", "UpdateProviderCatalog"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
