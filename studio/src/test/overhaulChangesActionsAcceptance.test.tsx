import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useChangesActions,
  type ChangesCommands,
} from "../features/agents/worktrees/changes/useChangesActions";

function Harness(commands: ChangesCommands) {
  const actions = useChangesActions(commands);
  return (
    <div>
      <button type="button" onClick={() => actions.runPrimary()}>
        {actions.primary.label}
      </button>
      {actions.confirmingStack ? (
        <div role="dialog" aria-label="Confirm Changes action">
          <p>{commands.branch}</p>
          <button type="button" onClick={() => void actions.runStack()}>Confirm</button>
        </div>
      ) : null}
      <p aria-label="Changes action state">
        {actions.busy ? "running" : actions.error ?? "idle"}
      </p>
    </div>
  );
}

describe("overhaul acceptance - stacked Changes actions", () => {
  it("confirms and settles the task stack in order", async () => {
    const calls: string[] = [];
    render(
      <Harness
        stackKind="task"
        branch="feature/changes"
        dirty
        unpushedCount={2}
        pullRequestCreationEligible
        onCommit={async () => { calls.push("commit-only"); }}
        onPush={async () => { calls.push("push-only"); }}
        onStack={async () => { calls.push("commit_push"); return { head_commit: "abc" }; }}
        onCreatePullRequest={async () => { calls.push("pull_request"); return { url: "https://example.test/pr/1" }; }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Commit, push & create PR" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("feature/changes");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Changes action state")).toHaveTextContent("idle"),
    );
    expect(calls).toEqual(["commit_push", "pull_request"]);
  });

  it("reports the failing step and runs nothing after it", async () => {
    const calls: string[] = [];
    render(
      <Harness
        stackKind="task"
        branch="feature/changes"
        dirty
        unpushedCount={1}
        pullRequestCreationEligible
        onCommit={async () => { calls.push("commit-only"); }}
        onPush={async () => { calls.push("push-only"); }}
        onStack={async () => { throw new Error("Commit refused the hook."); }}
        onCreatePullRequest={async () => { calls.push("pull_request"); return { url: "https://example.test/pr/1" }; }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Commit, push & create PR" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Changes action state")).toHaveTextContent(
        "Commit refused the hook.",
      ),
    );
    expect(calls).toEqual([]);
  });
});
