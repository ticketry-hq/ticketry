import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { StudioFooter } from "../app/shell/StudioFooter";
import { useStudioStore } from "../features/projects/store";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";

const settingsApi = vi.hoisted(() => ({
  getIssueTypes: vi.fn(),
  getStates: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...settingsApi,
}));

vi.mock("../features/workflows/providerQueries", () => ({
  setProviderCapabilities: vi.fn(),
  loadProviderCapabilities: settingsApi.getLaunchProviderCapabilities,
  loadConfigurableProviderCapabilities: async () => providerCapabilities,
  getProviderCapabilitiesSnapshot: () => providerCapabilities,
  loadProviderCatalog: async () => (await settingsApi.getProviderCatalog()).value,
  updateProviderCatalog: async (value: unknown) =>
    (await settingsApi.putProviderCatalog(value)).value,
  useProviderCatalogQuery: () => ({ data: savedCatalog, isLoading: false, isError: false }),
  useProviderCapabilitiesQuery: () => ({ data: providerCapabilities, isLoading: false, isError: false }),
}));

const savedCatalog = {
  activated_providers: ["claude", "codex"] as const,
  global_default: {
    provider: "claude" as const,
    model: "sonnet",
    reasoning: "high",
  },
};

const providerCapabilities = [
  {
    agent: "claude",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["sonnet", "opus", "haiku"],
    model_prefixes: ["claude-"],
    reasoning_levels: ["low", "medium", "high"],
  },
  {
    agent: "codex",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["gpt-5.6-luna"],
    model_prefixes: ["gpt-"],
    reasoning_levels: ["low", "medium", "high"],
  },
];

function renderAndOpenSettings() {
  render(
    <>
      <StudioFooter />
      <ModalHost />
    </>,
  );

  const opener = screen.getByRole("button", { name: "Open Settings" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

function GlobalKeymapHarness() {
  useGlobalKeymap();
  return null;
}

describe("overhaul acceptance — settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({
      modalStack: [],
      presentedNoticeIds: new Set(),
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useWorkflowEditorStore.setState(
      useWorkflowEditorStore.getInitialState(),
      true,
    );
    settingsApi.getLaunchProviderCapabilities.mockResolvedValue(
      providerCapabilities,
    );
    settingsApi.getProviderCatalog.mockResolvedValue({ value: savedCatalog });
    settingsApi.putProviderCatalog.mockImplementation(async (value) => ({
      value,
    }));
  });

  it("[overhaul-22] cold-opens Settings onto Models without loading workflow catalogs", async () => {
    renderAndOpenSettings();

    const dialog = await screen.findByRole("dialog", {
      name: "Studio settings",
    });
    expect(
      await within(dialog).findByRole("heading", { name: "Models" }),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByRole("region", {
        name: "Model configuration",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue("claude");
    expect(within(dialog).getByLabelText("Model"))
      .toHaveValue("sonnet");
    expect(within(dialog).getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue("high");
    expect(within(dialog).getByText("No unsaved changes")).toBeInTheDocument();

    expect(within(dialog).queryByRole("group", { name: "Workflow" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: "States" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: "Issue types" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "State catalog" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add state" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "State name" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("State name for Todo"))
      .not.toBeInTheDocument();

    expect(settingsApi.getProviderCatalog).toHaveBeenCalledOnce();
    expect(settingsApi.getLaunchProviderCapabilities).toHaveBeenCalledOnce();
    expect(settingsApi.getIssueTypes).not.toHaveBeenCalled();
    expect(settingsApi.getStates).not.toHaveBeenCalled();
    expect(settingsApi.getProjectWorkItems).not.toHaveBeenCalled();
    expect(settingsApi.getIssueTypeWorkflowSettings).not.toHaveBeenCalled();
  });

  it("[overhaul-122] keeps the keyboard shortcut reference inside Settings instead of the footer", async () => {
    render(
      <>
        <GlobalKeymapHarness />
        <StudioFooter />
        <ModalHost />
      </>,
    );

    expect(
      screen.queryByRole("button", { name: "Open Keyboard Shortcuts" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "?" });

    const dialog = await screen.findByRole("dialog", {
      name: "Studio settings",
    });

    expect(
      within(dialog).getByRole("heading", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("table", {
        name: "Effective keyboard bindings by action and Keymap context",
      }),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Models" }));
    expect(
      within(dialog).getByRole("heading", { name: "Models" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Keyboard shortcuts" }),
    );
    expect(
      within(dialog).getByRole("heading", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
  });

  it("keeps validation, discard, save, failure, and model-only status behavior", async () => {
    renderAndOpenSettings();

    const dialog = await screen.findByRole("dialog", {
      name: "Studio settings",
    });
    const model = await within(dialog).findByLabelText("Model");
    const reasoning = within(dialog).getByRole("combobox", {
      name: "Reasoning",
    });
    const discard = within(dialog).getByRole("button", { name: "Discard" });
    const save = within(dialog).getByRole("button", { name: "Save changes" });

    fireEvent.change(model, { target: { value: "not-a-claude-model" } });
    expect(
      await within(dialog).findByText(
        "Model 'not-a-claude-model' is not compatible with agent/provider 'claude'.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 unsaved change")).toBeInTheDocument();
    expect(discard).toBeEnabled();
    expect(save).toBeEnabled();

    fireEvent.click(discard);
    await waitFor(() => expect(model).toHaveValue("sonnet"));
    expect(reasoning).toHaveValue("high");
    expect(within(dialog).getByText("No unsaved changes")).toBeInTheDocument();
    expect(settingsApi.putProviderCatalog).not.toHaveBeenCalled();

    fireEvent.change(model, { target: { value: "opus" } });
    fireEvent.change(reasoning, { target: { value: "medium" } });
    expect(within(dialog).getByText("2 unsaved changes")).toBeInTheDocument();
    fireEvent.click(save);

    await waitFor(() => {
      expect(settingsApi.putProviderCatalog).toHaveBeenCalledWith({
        activated_providers: ["claude", "codex"],
        global_default: {
          provider: "claude",
          model: "opus",
          reasoning: "medium",
        },
      });
    });
    expect(
      await within(dialog).findByText("Model configuration saved."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("No unsaved changes")).toBeInTheDocument();
    const applied = within(dialog).getByRole("log", { name: "Applied changes" });
    expect(within(applied).getAllByText("Models")).toHaveLength(2);
    expect(within(applied).queryByText("Workflow")).not.toBeInTheDocument();

    settingsApi.putProviderCatalog.mockRejectedValueOnce(
      new Error("Provider catalog save failed."),
    );
    fireEvent.change(model, { target: { value: "haiku" } });
    fireEvent.click(save);

    expect(
      await within(dialog).findByText("Provider catalog save failed."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 unsaved change")).toBeInTheDocument();
    expect(model).toHaveValue("haiku");
    expect(settingsApi.putProviderCatalog).toHaveBeenCalledTimes(2);
    expect(within(applied).getAllByText("Models")).toHaveLength(3);
    expect(within(applied).queryByText("Workflow")).not.toBeInTheDocument();
  });

  it("preserves close, Escape, focus restoration, and focus containment", async () => {
    const opener = renderAndOpenSettings();

    let dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    await within(dialog).findByRole("region", { name: "Model configuration" });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    const reasoning = within(dialog).getByRole("combobox", {
      name: "Reasoning",
    });

    expect(close).toHaveFocus();
    reasoning.focus();
    fireEvent.keyDown(reasoning, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(reasoning).toHaveFocus();

    fireEvent.click(close);
    expect(screen.queryByRole("dialog", { name: "Studio settings" }))
      .not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Studio settings" }))
      .not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
