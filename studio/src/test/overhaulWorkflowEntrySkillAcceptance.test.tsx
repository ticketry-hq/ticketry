import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LaunchConfigurationForm } from "../features/workflows/LaunchConfigurationForm";
import type { IssueType, State } from "../shared/api/types";

it("[overhaul-140] edits or clears a launch binding's entry skill", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <LaunchConfigurationForm
      binding={{
        state_id: "spec",
        prompt: "Write the specification.",
        required_skills: ["to-spec", "tdd"],
        entry_skill: null,
        agent: null,
        model: null,
        reasoning: null,
        auto_start: false,
        subtree_run_enabled: false,
      }}
      issueType={{ id: "story", name: "Story" } as IssueType}
      providerCapabilities={[]}
      save={save}
      state={{ id: "spec", name: "Spec" } as State}
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
  expect(screen.queryByText(/to-spec can only start through user input/)).toBeNull();

  fireEvent.change(entrySkill, { target: { value: "" } });
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ entry_skill: null }),
  ));
  expect(screen.getByText(/to-spec can only start through user input/)).toBeVisible();
});
