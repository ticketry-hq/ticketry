import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPicker } from "../features/agents/terminal/AgentPicker";
import {
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../features/agents/terminal";
import { useModalStore } from "../app/modal";
import { useIssueDrawerWorkspaceStore } from "../features/work-items/issue-detail";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import { useLaunchProviderCatalog } from "../features/workflows/launchProviderCatalog";
import type {
  IssueType,
  ProviderCapabilities,
  State,
} from "../shared/api/types";

// ADR-0015 · CODIN-1432 — activation is published in one place, the filtered
// provider-capabilities payload. Every surface that offers or configures a
// launch reads it, so a deactivated provider cannot be picked and a
// configuration still bound to one says exactly why its launches are blocked.

const capability = (
  agent: string,
  overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities => ({
  agent,
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: [],
  model_prefixes: [`${agent}-`],
  reasoning_levels: ["low", "high"],
  ...overrides,
});

/** The payload after the host deactivated gemini; `agy` is never in it. */
const WITHOUT_GEMINI = [
  capability("claude", { model_aliases: ["sonnet", "opus"] }),
  capability("codex", { model_prefixes: ["gpt-"] }),
];

function activate(capabilities: ProviderCapabilities[]): void {
  useLaunchProviderCatalog.setState({ capabilities, loaded: true });
}

describe("agent picker reflects host activation", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
    useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
    useModalStore.setState({ modalStack: [{ type: "agent-picker" }] });
  });

  it("omits a deactivated provider and still launches an activated one", () => {
    activate(WITHOUT_GEMINI);
    render(
      <AgentPicker
        payload={{
          mode: "open",
          projectId: "proj-1",
          moduleId: "mod-1",
          taskId: "task-1",
          ticketSeq: 7,
        }}
      />,
    );

    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.queryByText("gemini")).not.toBeInTheDocument();
    // The payload never carries `agy`, so it is absent here for the same reason.
    expect(screen.queryByText("agy")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("codex"));
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agent: "codex", taskId: "task-1" }),
    ]);
  });

  it("offers nothing and points at Settings when no provider is activated", () => {
    activate([]);
    render(
      <AgentPicker
        payload={{ mode: "open", projectId: "proj-1", moduleId: "mod-1", taskId: "task-1" }}
      />,
    );

    expect(screen.queryByText("claude")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Activate one in Settings → Model configuration/),
    ).toBeInTheDocument();
  });
});

describe("launch configuration bound to a deactivated provider", () => {
  const issueType = { id: "story", name: "Story" } as IssueType;
  const state = { id: "implement", name: "Implement" } as State;

  function renderForm(agent: string, model: string | null = null) {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <LaunchConfigurationForm
        binding={{
          state_id: "implement",
          prompt: "Do the work.",
          agent,
          model,
          reasoning: null,
          auto_start: false,
          subtree_run_enabled: false,
        }}
        issueType={issueType}
        providerCapabilities={WITHOUT_GEMINI}
        save={save}
        state={state}
      />,
    );
    return save;
  }

  it("explains the block rather than calling the provider unsupported", () => {
    renderForm("gemini");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("'gemini' is deactivated");
    expect(alert).toHaveTextContent("Settings → Model configuration");
    expect(alert).not.toHaveTextContent("is not supported");
  });

  it("still reports a provider with no adapter as unsupported", () => {
    renderForm("nonesuch");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Agent/provider 'nonesuch' is not supported.",
    );
  });

  it("resets the model when the provider changes and persists the reset", () => {
    const save = renderForm("claude", "sonnet");

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("sonnet");
    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "codex", model: null }),
    );
  });
});
