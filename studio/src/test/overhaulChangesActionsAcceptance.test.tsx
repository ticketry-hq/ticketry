import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangesActions } from "../features/agents/worktrees/changes/ChangesActions";

describe("overhaul acceptance - stacked Changes actions", () => {
  it("confirms and settles the task stack in order", async () => {
    const calls: string[] = [];
    render(
      <ChangesActions
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

    await waitFor(() => expect(screen.getByLabelText("Changes action outcome")).toHaveTextContent("Action complete"));
    expect(calls).toEqual(["commit_push", "pull_request"]);
    expect(screen.getByLabelText("Changes action outcome")).toHaveTextContent("stage: skipped");
    expect(screen.getByLabelText("Changes action outcome")).toHaveTextContent("pull request: ok");
  });
});
