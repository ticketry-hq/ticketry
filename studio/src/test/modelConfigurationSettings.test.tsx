import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  previewProviderCatalogImpact: vi.fn(),
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
  fireEvent.click(await screen.findByRole("tab", { name: "Models" }));
  return await screen.findByRole("region", { name: "Model configuration" });
}

describe("Model configuration settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({ modalStack: [{ type: "settings" }], activeBindings: null });
    useTasksStore.setState({ selectedProjectId: null });
    useWorkflowEditorStore.setState({ providerCapabilities: [] });
    catalogApi.getLaunchProviderCapabilities.mockResolvedValue(capabilities);
    // A save previews its blast radius first; most tests deactivate nothing
    // that any binding names, so the default preview is "nothing blocked".
    catalogApi.previewProviderCatalogImpact.mockResolvedValue({
      blocked_launch_bindings: 0,
    });
  });

  it("shows commit actions only for the save-gated Models section", async () => {
    await openModelConfiguration();

    expect(
      screen.getByRole("region", { name: "Settings commit actions" }),
    ).toHaveTextContent("No unsaved changes");
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "States" }));
    expect(
      screen.queryByRole("region", { name: "Settings commit actions" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Issue types" }));
    expect(
      screen.queryByRole("region", { name: "Settings commit actions" }),
    ).not.toBeInTheDocument();
  });

  it("counts outstanding changes and discards the draft without closing", async () => {
    await openModelConfiguration({
      activated_providers: ["claude", "codex"],
      global_default: { provider: "claude", model: "sonnet", reasoning: null },
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "opus" },
    });

    expect(
      screen.getByRole("region", { name: "Settings commit actions" }),
    ).toHaveTextContent("2 unsaved changes");
    expect(screen.getByRole("log", { name: "Applied changes" }))
      .toHaveTextContent("gemini activation changed from Off to On");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByRole("dialog", { name: "Studio settings" })).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Settings commit actions" }),
    ).toHaveTextContent("No unsaved changes");
    expect(screen.getByRole("checkbox", { name: "Activate gemini" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("sonnet");
    expect(screen.getByRole("log", { name: "Applied changes" }))
      .toHaveTextContent("No changes yet.");
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
    const pendingEntry = within(
      screen.getByRole("log", { name: "Applied changes" }),
    ).getByText("launch reasoning changed from not configured to high").closest("li");
    expect(pendingEntry).toHaveAttribute("data-tone", "pending");
    expect(pendingEntry).toHaveTextContent("--:--");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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
    expect(
      screen.getByRole("region", { name: "Settings commit actions" }),
    ).toHaveTextContent("No unsaved changes");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(pendingEntry).toHaveAttribute("data-tone", "applied");
    expect(pendingEntry).not.toHaveTextContent("--:--");
  });

  it("shows only the three newest ledger entries", async () => {
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

    expect(
      within(screen.getByRole("log", { name: "Applied changes" }))
        .getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("refuses to deactivate the provider the global default uses", async () => {
    await openModelConfiguration({
      activated_providers: ["claude", "codex", "gemini"],
      global_default: { provider: "codex", model: "gpt-5.4", reasoning: null },
    });

    const codex = screen.getByRole("checkbox", { name: "Activate codex" });
    expect(codex).toBeChecked();
    expect(codex).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Activate claude" })).toBeEnabled();

    fireEvent.click(codex);
    expect(codex).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Repoint the launch default before deactivating codex.",
    );

    // Repointing the default allows codex to be deactivated.
    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "claude" },
    });
    expect(screen.getByRole("checkbox", { name: "Activate codex" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Activate claude" })).toBeEnabled();

    catalogApi.putProviderCatalog.mockImplementation(
      async (value: ProviderCatalog) => ({ value }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Activate codex" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "opus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(catalogApi.putProviderCatalog).not.toHaveBeenCalled();
  });

  it("confirms before a deactivation that would block launch bindings", async () => {
    // Every other workflow mutation previews its blast radius. A deactivation
    // used to save silently and be discovered one failed launch at a time.
    catalogApi.previewProviderCatalogImpact.mockResolvedValue({
      blocked_launch_bindings: 3,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await openModelConfiguration();

      fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm.mock.calls[0][0]).toContain("3 launch configurations");
      expect(catalogApi.putProviderCatalog).not.toHaveBeenCalled();
      // Declining leaves the draft alone rather than reverting it.
      expect(screen.getByRole("checkbox", { name: "Activate gemini" }))
        .not.toBeChecked();
    } finally {
      confirm.mockRestore();
    }
  });

  it("reports the blocked bindings in the notice once the save is confirmed", async () => {
    catalogApi.previewProviderCatalogImpact.mockResolvedValue({
      blocked_launch_bindings: 1,
    });
    catalogApi.putProviderCatalog.mockImplementation(
      async (value: ProviderCatalog) => ({ value, blocked_launch_bindings: 1 }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await openModelConfiguration();

      fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        "1 launch configuration names a deactivated provider",
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it("renders a pydantic 422's per-field messages, not a bare status", async () => {
    catalogApi.putProviderCatalog.mockRejectedValue(
      new ApiError(422, "HTTP 422", {
        detail: [{ msg: "reasoning is not valid for provider 'gemini'" }],
      }),
    );
    await openModelConfiguration();

    fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "reasoning is not valid for provider 'gemini'",
    );
  });

  it("surfaces a rejected catalog without clearing the draft", async () => {
    catalogApi.putProviderCatalog.mockRejectedValue(
      new ApiError(422, "HTTP 422", {
        detail: "global default provider must be activated",
      }),
    );
    await openModelConfiguration();

    fireEvent.click(screen.getByRole("checkbox", { name: "Activate gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "global default provider must be activated",
    );
    expect(screen.getByRole("checkbox", { name: "Activate gemini" })).not.toBeChecked();
  });
});
