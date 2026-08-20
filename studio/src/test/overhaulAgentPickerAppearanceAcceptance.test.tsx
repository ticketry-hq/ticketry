import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { providerToneClasses } from "../features/agents/terminal/presentation/providerPresentation";
import {
  ModalHost,
  providerApi,
  providerCapability,
  setProviderCapabilities,
  terminalApi,
  useModalStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";

const launchPayload = {
  mode: "open" as const,
  projectId: "project-822",
  moduleId: "module-822",
  taskId: "task-822",
};

function openPicker(): void {
  act(() => {
    useModalStore.getState().pushModal({
      type: "agent-picker",
      payload: launchPayload,
    });
  });
}

function expectTone(
  choice: HTMLElement,
  agent: "claude" | "agy" | "codex" | "gemini",
  selected: boolean,
): void {
  for (const token of providerToneClasses({
    agent,
    live: true,
    selected,
    ground: "pane-panel",
  }).split(" ")) {
    expect(choice).toHaveClass(token);
  }
  if (!selected) {
    expect(choice).toHaveClass("bg-pane-panel");
    expect(choice).not.toHaveClass("bg-pane-bg");
  }
}

describe("overhaul acceptance — agent-picker appearance", () => {
  it("[overhaul-143] presents launch choices with live terminal-tab provider tones", async () => {
    const capabilities = [
      providerCapability("gemini"),
      providerCapability("codex"),
      providerCapability("agy"),
      providerCapability("claude"),
    ];
    providerApi.getLaunchProviderCapabilities.mockResolvedValue(capabilities);
    setProviderCapabilities(capabilities);
    useModalStore.setState({ modalStack: [] });

    render(
      workspaceView({
        launchContext: {
          kind: "task",
          taskId: "task-822",
          projectId: "project-822",
          moduleId: "module-822",
          taskKey: "CODIN-822",
          taskName: "Align the terminal picker",
        },
        bucket: "task-822",
        projectId: "project-822",
        moduleId: "module-822",
        children: <ModalHost />,
      }),
    );

    openPicker();
    const dialog = await screen.findByRole("dialog", { name: "Select Agent" });
    const picker = within(dialog);
    const choices = ["claude", "agy", "codex", "gemini"].map((agent) =>
      picker.getByRole("button", { name: agent }),
    );
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "claude",
      "agy",
      "codex",
      "gemini",
    ]);
    expect(picker.getByRole("list")).toHaveClass("flex", "flex-wrap");
    expect(picker.queryByRole("tab")).not.toBeInTheDocument();
    expect(picker.queryByRole("tablist")).not.toBeInTheDocument();
    const closeButton = picker.getByRole("button", { name: "Close dialog" });
    expect(closeButton).toHaveFocus();
    for (const choice of choices) {
      expect(choice).toHaveAttribute("tabindex", "-1");
    }
    fireEvent.keyDown(closeButton, { key: "Tab" });
    expect(closeButton).toHaveFocus();
    expectTone(choices[0], "claude", true);
    expectTone(choices[1], "agy", false);
    expectTone(choices[2], "codex", false);
    expectTone(choices[3], "gemini", false);

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expectTone(choices[0], "claude", false);
    expectTone(choices[1], "agy", true);
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expectTone(choices[0], "claude", true);
    expectTone(choices[1], "agy", false);
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() =>
      expect(terminalApi.createTerminalRun).toHaveBeenCalledWith({
        agent: "codex",
        project_id: "project-822",
        module_id: "module-822",
        task_id: "task-822",
        initial_prompt: null,
        is_planning: false,
        is_instant: false,
        instant_prompt: null,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("tab", { name: "codex terminal" }),
    ).toHaveAttribute("aria-selected", "true");

    openPicker();
    const reopened = await screen.findByRole("dialog", { name: "Select Agent" });
    const reopenedPicker = within(reopened);
    const keyboardChoice = reopenedPicker.getByRole("button", { name: "agy" });
    const pointerChoice = reopenedPicker.getByRole("button", { name: "gemini" });
    fireEvent.keyDown(reopened, { key: "ArrowDown" });
    fireEvent.mouseEnter(pointerChoice);
    expect(keyboardChoice).toHaveAttribute("aria-current", "true");
    expect(pointerChoice).not.toHaveAttribute("aria-current");
    expect(pointerChoice).toHaveClass("hover:bg-pane-title");
    expectTone(keyboardChoice, "agy", true);
    expectTone(pointerChoice, "gemini", false);
    fireEvent.click(pointerChoice);
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(2));
    expect(terminalApi.createTerminalRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "gemini" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const filteredCapabilities = [
      providerCapability("gemini"),
      providerCapability("claude"),
      providerCapability("codex"),
    ];
    providerApi.getLaunchProviderCapabilities.mockResolvedValue(filteredCapabilities);
    setProviderCapabilities(filteredCapabilities);
    openPicker();
    const filtered = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(
      within(filtered)
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-label") !== "Close dialog")
        .map((button) => button.textContent),
    ).toEqual(["claude", "codex", "gemini"]);
    expect(within(filtered).queryByRole("button", { name: "agy" })).not.toBeInTheDocument();

    act(() => useModalStore.getState().popModal());
    providerApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    setProviderCapabilities([]);
    openPicker();
    const empty = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(
      within(empty).getByText(
        "No activated providers. Activate one in Settings → Model configuration.",
      ),
    ).toBeVisible();
    expect(within(empty).queryByRole("list")).not.toBeInTheDocument();
  });
});
