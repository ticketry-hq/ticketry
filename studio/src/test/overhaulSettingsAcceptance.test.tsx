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
    models: [
      { name: "sonnet", reasoning_levels: ["low", "medium", "high"] },
      { name: "opus", reasoning_levels: ["low", "medium", "high"] },
      { name: "haiku", reasoning_levels: ["low", "medium"] },
    ],
  },
  {
    agent: "codex",
    models: [
      { name: "gpt-5.6-sol", reasoning_levels: ["high", "low", "max", "medium", "ultra", "xhigh"] },
      { name: "gpt-5.6-terra", reasoning_levels: ["high", "low", "max", "medium", "ultra", "xhigh"] },
      { name: "gpt-5.6-luna", reasoning_levels: ["high", "low", "max", "medium", "xhigh"] },
    ],
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
    expect(
      within(dialog).getAllByText("Choose provider for task"),
    ).toHaveLength(2);
    expect(
      within(dialog).getByText("Show or launch task terminal"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Open task with prompt outside Stories"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByText("Enter edit-view selection"),
    ).toHaveLength(2);
    expect(within(dialog).queryByText("tasks.choose-provider"))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByText("edit-view.choose-provider"))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByText("Open task"))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByText("Open with prompt"))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByText("Engage body"))
      .not.toBeInTheDocument();

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

    fireEvent.change(model, { target: { value: "opus" } });
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

  it("[overhaul-127] preserves the Codex model matrix and round-trips low", async () => {
    const opener = renderAndOpenSettings();
    let dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    const provider = within(dialog).getByRole("combobox", {
      name: "Agent/provider",
    });
    const model = within(dialog).getByRole("combobox", { name: "Model" });
    const reasoning = within(dialog).getByRole("combobox", { name: "Reasoning" });

    fireEvent.change(provider, { target: { value: "codex" } });
    expect(model).toHaveValue("");
    expect(within(reasoning).getAllByRole("option")).toHaveLength(1);

    fireEvent.change(model, { target: { value: "gpt-5.6-sol" } });
    expect(within(reasoning).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Model default", "low", "medium", "high", "xhigh", "max", "ultra"]);
    fireEvent.change(reasoning, { target: { value: "ultra" } });

    fireEvent.change(model, { target: { value: "gpt-5.6-luna" } });
    expect(reasoning).toHaveValue("");
    expect(within(reasoning).queryByRole("option", { name: "ultra" }))
      .not.toBeInTheDocument();
    expect(within(reasoning).getByRole("option", { name: "max" }))
      .toBeInTheDocument();
    fireEvent.change(reasoning, { target: { value: "low" } });

    fireEvent.change(model, { target: { value: "gpt-5.6-terra" } });
    expect(reasoning).toHaveValue("low");
    expect(within(reasoning).getByRole("option", { name: "ultra" }))
      .toBeInTheDocument();
    fireEvent.change(model, { target: { value: "gpt-5.6-luna" } });
    expect(reasoning).toHaveValue("low");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(settingsApi.putProviderCatalog).toHaveBeenCalledWith({
      activated_providers: ["claude", "codex"],
      global_default: {
        provider: "codex",
        model: "gpt-5.6-luna",
        reasoning: "low",
      },
    }));

    settingsApi.getProviderCatalog.mockResolvedValue({
      value: {
        activated_providers: ["claude", "codex"],
        global_default: {
          provider: "codex",
          model: "gpt-5.6-luna",
          reasoning: "low",
        },
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    fireEvent.click(opener);
    dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    expect(await within(dialog).findByRole("combobox", { name: "Model" }))
      .toHaveValue("gpt-5.6-luna");
    expect(within(dialog).getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue("low");
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
