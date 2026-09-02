import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type {
  IssueType,
  LaunchBindingInput,
  ScopedWorkflowLaunchBinding,
  State,
} from "../shared/api/types";

const issueType = { id: "story", name: "Story" } as IssueType;
const state = { id: "spec", name: "Spec" } as State;

function binding(entrySkill: string | null): ScopedWorkflowLaunchBinding {
  return {
    state_id: "spec",
    prompt: "Write the specification.",
    required_skills: ["to-spec", "tdd"],
    entry_skill: entrySkill,
    agent: null,
    model: null,
    reasoning: null,
    auto_start: false,
    subtree_run_enabled: false,
  };
}

it("[overhaul-243] saves, clears, and reloads a workflow entry skill", async () => {
  let stored = binding(null);
  const save = vi.fn(async (input: LaunchBindingInput) => {
    stored = {
      ...stored,
      entry_skill: input.entry_skill === undefined
        ? stored.entry_skill
        : input.entry_skill,
    };
  });
  const first = render(
    <LaunchConfigurationForm
      binding={stored}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );

  const entrySkill = screen.getByRole("combobox", { name: "Entry skill" });
  expect(entrySkill).toHaveValue("");
  expect(screen.getByRole("option", { name: "to-spec" })).toBeVisible();
  expect(screen.getByText(/to-spec can only start through user input/)).toBeVisible();

  fireEvent.change(entrySkill, { target: { value: "to-spec" } });
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ entry_skill: "to-spec" }),
  ));
  first.unmount();

  const reopened = render(
    <LaunchConfigurationForm
      binding={stored}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Entry skill" })).toHaveValue("to-spec");

  fireEvent.change(screen.getByRole("combobox", { name: "Entry skill" }), {
    target: { value: "" },
  });
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ entry_skill: null }),
  ));
  reopened.unmount();

  render(
    <LaunchConfigurationForm
      binding={stored}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Entry skill" })).toHaveValue("");
});
