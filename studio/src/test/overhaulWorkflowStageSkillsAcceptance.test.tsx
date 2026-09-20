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

function binding(stageSkills: string[]): ScopedWorkflowLaunchBinding {
  return {
    state_id: "spec",
    prompt: "Write the specification.",
    required_skills: ["required-but-not-selected"],
    stage_skills: stageSkills,
    agent: null,
    profile: null,
    model: null,
    reasoning: null,
    auto_start: false,
    subtree_run_enabled: false,
  };
}

it("[overhaul-243] saves an unknown stage skill as one tag and reopens it", async () => {
  let stored = binding([]);
  const save = vi.fn(async (input: LaunchBindingInput) => {
    stored = {
      ...stored,
      stage_skills: input.stage_skills ?? stored.stage_skills,
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

  const skills = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(skills, { target: { value: "future skill, one" } });
  fireEvent.keyDown(skills, { key: "Enter" });

  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage_skills: ["future skill, one"] }),
  ));
  expect(screen.queryByText(/can only start through user input/)).not.toBeInTheDocument();
  first.unmount();

  render(
    <LaunchConfigurationForm
      binding={stored}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );
  expect(screen.getByText("future skill, one")).toBeVisible();
  expect(screen.getByRole("button", {
    name: 'Remove skill "future skill, one"',
  })).toBeVisible();
});

it("commits on blur and ignores blank or duplicate names", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <LaunchConfigurationForm
      binding={binding(["tdd"])}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );

  const skills = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(skills, { target: { value: "   " } });
  fireEvent.blur(skills);
  fireEvent.change(skills, { target: { value: "tdd" } });
  fireEvent.keyDown(skills, { key: "Enter" });
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(skills, { target: { value: "  review this, carefully  " } });
  fireEvent.blur(skills);
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      stage_skills: ["tdd", "review this, carefully"],
    }),
  ));
});

it("removes each tag and reopens an explicitly empty selection", async () => {
  let stored = binding(["one", "two"]);
  const save = vi.fn(async (input: LaunchBindingInput) => {
    stored = { ...stored, stage_skills: input.stage_skills ?? stored.stage_skills };
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

  fireEvent.click(screen.getByRole("button", { name: 'Remove skill "one"' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage_skills: ["two"] }),
  ));
  fireEvent.click(screen.getByRole("button", { name: 'Remove skill "two"' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage_skills: [] }),
  ));
  first.unmount();

  render(
    <LaunchConfigurationForm
      binding={stored}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );
  expect(screen.getByLabelText("Selected skills")).toBeEmptyDOMElement();
});

it("keeps the attempted tags visible when the editor reports a save failure", async () => {
  const save = vi.fn().mockResolvedValue(null);
  const view = render(
    <LaunchConfigurationForm
      binding={binding([])}
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );
  const skills = screen.getByRole("textbox", { name: "Skills" });
  fireEvent.change(skills, { target: { value: "future" } });
  fireEvent.keyDown(skills, { key: "Enter" });
  await waitFor(() => expect(save).toHaveBeenCalled());

  view.rerender(
    <LaunchConfigurationForm
      binding={{ ...binding([]), prompt: "Updated elsewhere." }}
      error="Could not save workflow skills."
      issueType={issueType}
      providerCapabilities={[]}
      save={save}
      state={state}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save workflow skills.");
  expect(screen.getByText("future")).toBeVisible();
});
