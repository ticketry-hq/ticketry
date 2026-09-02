import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type {
  IssueType,
  ProviderCapabilities,
  ScopedWorkflowLaunchBinding,
  State,
} from "../shared/api/types";

const capabilities: ProviderCapabilities[] = [{
  agent: "codex",
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: ["gpt-5.6-luna", "gpt-5.6-terra"],
  model_prefixes: [],
  reasoning_levels: ["medium"],
}];
const issueType = { id: "story", name: "Story" } as IssueType;
const state = { id: "implement", name: "Implement" } as State;
const binding: ScopedWorkflowLaunchBinding = {
  state_id: "implement",
  prompt: "Initial prompt",
  required_skills: [],
  entry_skill: null,
  agent: "codex",
  model: "gpt-5.6-luna",
  reasoning: "medium",
  auto_start: false,
  subtree_run_enabled: false,
};

it("[overhaul-246] refreshes an untouched launch form from the canonical binding", () => {
  const properties = {
    issueType,
    providerCapabilities: capabilities,
    save: vi.fn().mockResolvedValue(undefined),
    state,
  };
  const view = render(
    <LaunchConfigurationForm {...properties} binding={binding} />,
  );

  view.rerender(
    <LaunchConfigurationForm
      {...properties}
      binding={{
        ...binding,
        prompt: "Updated by another editor",
        model: "gpt-5.6-terra",
      }}
    />,
  );

  expect(screen.getByLabelText("Prompt"))
    .toHaveValue("Updated by another editor");
  expect(screen.getByRole("combobox", { name: "Model" }))
    .toHaveValue("gpt-5.6-terra");
});
