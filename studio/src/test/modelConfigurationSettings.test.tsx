import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { ApiError } from "../shared/api/client";
import { SettingsModal } from "../features/studio/modals/SettingsModal";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import type { ProviderCatalog } from "../shared/api/types";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";

const catalogApi = vi.hoisted(() => ({
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  ...catalogApi,
}));

const capabilities = [
  {
    agent: "claude",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["sonnet", "opus"],
    model_prefixes: ["claude-"],
    reasoning_levels: ["low", "medium", "high"],
  },
  {
    agent: "codex",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: [],
    model_prefixes: ["gpt-"],
    reasoning_levels: ["minimal", "medium", "xhigh"],
  },
  {
    agent: "gemini",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: [],
    model_prefixes: ["gemini-"],
    reasoning_levels: [],
  },
];

const firstRunCatalog: ProviderCatalog = {
  activated_providers: ["claude", "codex", "gemini"],
  global_default: null,
};

async function openModelConfiguration(catalog: ProviderCatalog = firstRunCatalog) {
  catalogApi.getProviderCatalog.mockResolvedValue({ value: catalog });
  render(<SettingsModal runtimePlatform="desktop" />);
  fireEvent.click(await screen.findByRole("tab", { name: "Model configuration" }));
  return await screen.findByRole("region", { name: "Model configuration" });
}

describe("Model configuration settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({ modalStack: [{ type: "settings" }], activeBindings: null });
    useTasksStore.setState({ selectedProjectId: null });
    useWorkflowEditorStore.setState({ providerCapabilities: [] });
    catalogApi.getLaunchProviderCapabilities.mockResolvedValue(capabilities);
  });

  it("saves provider activation and the global default through the catalog endpoint", async () => {
    catalogApi.putProviderCatalog.mockImplementation(async (value: ProviderCatalog) => ({
      value,
    }));
    await openModelConfiguration();

    fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "claude" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "sonnet" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenCalledWith({
        activated_providers: ["claude", "codex"],
        global_default: { provider: "claude", model: "sonnet", reasoning: "high" },
      });
    });
    await screen.findByText("Model configuration saved.");
    // The picker reflects what the server echoed back, and a clean draft
    // leaves nothing to save.
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("sonnet");
    expect(screen.getByRole("checkbox", { name: "Activate gemini" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("refuses to deactivate the provider the global default uses", async () => {
    await openModelConfiguration({
      activated_providers: ["claude", "codex", "gemini"],
      global_default: { provider: "codex", model: "gpt-5.4", reasoning: null },
    });

    const codex = screen.getByRole("checkbox", { name: "Activate codex" });
    expect(codex).toBeChecked();
    expect(codex).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Activate claude" })).toBeEnabled();

    // Repointing the default releases the guard on codex.
    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "claude" },
    });
    expect(screen.getByRole("checkbox", { name: "Activate codex" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Activate claude" })).toBeDisabled();

    catalogApi.putProviderCatalog.mockImplementation(
      async (value: ProviderCatalog) => ({ value }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Activate codex" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "opus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(catalogApi.putProviderCatalog).toHaveBeenCalledWith({
        activated_providers: ["claude", "gemini"],
        global_default: { provider: "claude", model: "opus", reasoning: null },
      });
    });
  });

  it("refetches provider capabilities on save so the workflow editor sees the change", async () => {
    const savedCatalog: ProviderCatalog = {
      activated_providers: ["claude", "codex"],
      global_default: null,
    };
    catalogApi.putProviderCatalog.mockResolvedValue({ value: savedCatalog });
    await openModelConfiguration();

    expect(catalogApi.getLaunchProviderCapabilities).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(useWorkflowEditorStore.getState().providerCapabilities).toHaveLength(3);
    });

    catalogApi.getLaunchProviderCapabilities.mockResolvedValue(
      capabilities.filter((capability) => capability.agent !== "gemini"),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(catalogApi.getLaunchProviderCapabilities).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        useWorkflowEditorStore.getState().providerCapabilities.map((c) => c.agent),
      ).toEqual(["claude", "codex"]);
    });
  });

  it("blocks a default whose model does not belong to its provider", async () => {
    await openModelConfiguration();

    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "gemini" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "sonnet" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Model 'sonnet' is not compatible with agent/provider 'gemini'.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(catalogApi.putProviderCatalog).not.toHaveBeenCalled();
  });

  it("surfaces a rejected catalog without clearing the draft", async () => {
    catalogApi.putProviderCatalog.mockRejectedValue(
      new ApiError(422, "HTTP 422", {
        detail: "global default provider must be activated",
      }),
    );
    await openModelConfiguration();

    fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "global default provider must be activated",
    );
    expect(screen.getByRole("checkbox", { name: "Activate gemini" })).not.toBeChecked();
  });
});
