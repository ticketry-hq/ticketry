import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type {
  IssueType,
  LaunchBindingInput,
  ProviderCapabilities,
  State,
} from "../shared/api/types";

const capabilities: ProviderCapabilities[] = [
  {
    agent: "claude",
    models: [
      { name: "opus", reasoning_levels: ["low", "medium", "high"] },
      { name: "sonnet", reasoning_levels: ["low", "medium"] },
    ],
  },
  {
    agent: "gemini",
    models: [],
  },
];

const issueType = { id: "story", name: "Story" } as IssueType;
const state = { id: "ready", name: "Ready" } as State;

type SaveBinding = (binding: LaunchBindingInput) => Promise<unknown>;

function createSave() {
  return vi.fn<SaveBinding>().mockResolvedValue(undefined);
}

function renderForm(save: SaveBinding) {
  render(
    <LaunchConfigurationForm
      binding={{
        state_id: "ready",
        prompt: "do the thing",
        required_skills: [],
        entry_skill: null,
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
    const save = createSave();
    renderForm(save);

    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "gemini" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "do the thing",
      entry_skill: null,
      agent: "gemini",
      model: null,
      reasoning: null,
    });
  });

  it("writes a reasoning change against the provider on screen", async () => {
    const save = createSave();
    renderForm(save);

    fireEvent.change(screen.getByRole("combobox", { name: "Reasoning" }), {
      target: { value: "low" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "do the thing",
      entry_skill: null,
      agent: "claude",
      model: "opus",
      reasoning: "low",
    });
  });

  it("writes a model change with its normalized reasoning, not stale render values", async () => {
    const save = createSave();
    renderForm(save);

    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "sonnet" },
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      prompt: "do the thing",
      entry_skill: null,
      agent: "claude",
      model: "sonnet",
      reasoning: null,
    });
  });
});
