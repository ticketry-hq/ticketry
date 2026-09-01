import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type {
  IssueType,
  ProviderCapabilities,
  ScopedWorkflowLaunchBinding,
  State,
} from "../shared/api/types";

const capabilities: ProviderCapabilities[] = [
  {
    agent: "claude",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["opus", "sonnet"],
    model_prefixes: ["claude-"],
    reasoning_levels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    agent: "gemini",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: [],
    model_prefixes: ["gemini-"],
    // Gemini declares no reasoning levels at all, so any value is invalid.
    reasoning_levels: [],
  },
];

const issueType = { id: "story", name: "Story" } as IssueType;
const state = { id: "ready", name: "Ready" } as State;

const binding: ScopedWorkflowLaunchBinding = {
  state_id: "ready",
  prompt: "do the thing",
  required_skills: [],
  agent: "claude",
  model: "opus",
  reasoning: "high",
  auto_start: false,
  subtree_run_enabled: false,
};

function renderForm(save: ReturnType<typeof vi.fn>) {
  render(
    <LaunchConfigurationForm
      binding={binding}
      issueType={issueType}
      providerCapabilities={capabilities}
      save={save}
      state={state}
    />,
  );
}

describe("LaunchConfigurationForm", () => {
  it("writes the provider change without the old provider's reasoning", async () => {
    // The payload used to be merged into a memo from the *current* render, so
    // the setState calls from the same event had not landed and the write
    // carried the previous reasoning — a pair the server 422s, losing the save
    // while the form already showed the new provider.
    const save = vi.fn().mockResolvedValue(undefined);
    renderForm(save);

    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "gemini" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "do the thing",
      agent: "gemini",
      model: null,
      reasoning: null,
    });
  });

  it("writes a reasoning change against the provider on screen", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderForm(save);

    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "low" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "do the thing",
      agent: "claude",
      model: "opus",
      reasoning: "low",
    });
  });

  it("saves the stored prompt after the binding hydrates under a mounted form", async () => {
    // The Settings panel renders this form before the workflow read resolves.
    // Seeding `useState` from props froze `prompt` at "" for the life of that
    // instance, so the next provider change wrote an empty prompt over the
    // stored one and every launch for the type/state then failed with
    // `prompt_not_configured` (ticket #1372).
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <LaunchConfigurationForm
        issueType={issueType}
        providerCapabilities={capabilities}
        save={save}
        state={state}
      />,
    );

    view.rerender(
      <LaunchConfigurationForm
        binding={binding}
        issueType={issueType}
        providerCapabilities={capabilities}
        save={save}
        state={state}
      />,
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("do the thing");

    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "low" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "do the thing",
      agent: "claude",
      model: "opus",
      reasoning: "low",
    });
  });

  it("saves the newly selected state's prompt, not the previous state's", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const other = { id: "implement", name: "Implement" } as State;
    const view = render(
      <LaunchConfigurationForm
        binding={binding}
        issueType={issueType}
        providerCapabilities={capabilities}
        save={save}
        state={state}
      />,
    );

    view.rerender(
      <LaunchConfigurationForm
        binding={{ ...binding, state_id: "implement", prompt: "implement the slice" }}
        issueType={issueType}
        providerCapabilities={capabilities}
        save={save}
        state={other}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "low" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "implement the slice",
      agent: "claude",
      model: "opus",
      reasoning: "low",
    });
  });

  it("keeps text being typed when the stored binding is refreshed by a save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <LaunchConfigurationForm
        binding={binding}
        issueType={issueType}
        providerCapabilities={capabilities}
        save={save}
        state={state}
      />,
    );

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "do the thing, carefully" },
    });
    view.rerender(
      <LaunchConfigurationForm
        binding={{ ...binding, prompt: "do the thing" }}
        issueType={issueType}
        providerCapabilities={capabilities}
        save={save}
        state={state}
      />,
    );

    expect(screen.getByLabelText("Prompt")).toHaveValue("do the thing, carefully");
  });
});
