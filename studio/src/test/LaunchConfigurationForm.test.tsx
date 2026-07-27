import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type {
  IssueType,
  ProviderCapabilities,
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

function renderForm(save: ReturnType<typeof vi.fn>) {
  render(
    <LaunchConfigurationForm
      binding={{
        state_id: "ready",
        prompt: "do the thing",
        agent: "claude",
        model: "opus",
        reasoning: "high",
        auto_start: false,
        subtree_run_enabled: false,
      }}
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
});
