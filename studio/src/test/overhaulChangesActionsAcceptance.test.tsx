import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChangesToolbar } from "../features/agents/worktrees/changes/ChangesToolbar";
import {
  useChangesActions,
  type ChangesCommands,
} from "../features/agents/worktrees/changes/useChangesActions";
import { fixture, mountStudio } from "./seam";

function ToolbarHarness({ commands }: { commands: ChangesCommands }) {
  const actions = useChangesActions(commands);
  return (
    <section aria-label="Stable Changes section">
      <ChangesToolbar
        actions={actions}
        selectedTaskId={null}
        onOpenModule={() => undefined}
        onOpenTask={() => undefined}
      />
      {actions.notice ? <p role="status">{actions.notice}</p> : null}
      {actions.error ? <p role="alert">{actions.error}</p> : null}
      <button type="button">Review another control</button>
    </section>
  );
}

function commands(overrides: Partial<ChangesCommands> = {}): ChangesCommands {
  return {
    stackKind: "module",
    branch: "feature/keyboard",
    dirty: true,
    unpushedCount: 0,
    onCommit: async () => undefined,
    onPush: async () => undefined,
    onStack: async () => ({ head_commit: "abc" }),
    ...overrides,
  };
}

function toolbarFixture() {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  return http;
}

describe("overhaul acceptance - stacked Changes actions", () => {
  it("confirms and settles the task stack in order", async () => {
    const calls: string[] = [];
    mountStudio({
      http: toolbarFixture(),
      children: (
        <ToolbarHarness commands={commands({
          stackKind: "task",
          branch: "feature/changes",
          unpushedCount: 2,
          pullRequestCreationEligible: true,
          onStack: async () => { calls.push("commit_push"); },
          onCreatePullRequest: async () => {
            calls.push("pull_request");
            return { url: "https://example.test/pr/1" };
          },
        })} />
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "Commit, push & create PR on feature/changes" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("feature/changes");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("created a pull request"));
    expect(calls).toEqual(["commit_push", "pull_request"]);
  });

  it("reports the failing step and runs nothing after it", async () => {
    const calls: string[] = [];
    mountStudio({
      http: toolbarFixture(),
      children: (
        <ToolbarHarness commands={commands({
          stackKind: "task",
          branch: "feature/changes",
          unpushedCount: 1,
          pullRequestCreationEligible: true,
          onStack: async () => { throw new Error("Commit refused the hook."); },
          onCreatePullRequest: async () => {
            calls.push("pull_request");
            return { url: "https://example.test/pr/1" };
          },
        })} />
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "Commit, push & create PR on feature/changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Commit refused the hook."));
    expect(calls).toEqual([]);
  });

  it("[overhaul-352] opens on Cancel, cancels with Escape, and restores the action opener", () => {
    mountStudio({ http: toolbarFixture(), children: <ToolbarHarness commands={commands()} /> });

    const opener = screen.getByRole("button", { name: "Commit & push on feature/keyboard" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const confirmation = screen.getByRole("dialog", { name: "Confirm Changes action" });
    fireEvent.keyDown(confirmation, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Confirm Changes action" })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("[overhaul-353] submits once, locks pending cancellation, and does not steal moved focus", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const onStack = vi.fn(async () => { await pending; });
    mountStudio({
      http: toolbarFixture(),
      children: <ToolbarHarness commands={commands({ onStack })} />,
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose checkout" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Commit & push on feature/keyboard" }));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onStack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    const confirmation = screen.getByRole("dialog", { name: "Confirm Changes action" });
    fireEvent.keyDown(confirmation, { key: "Escape" });
    expect(confirmation).toBeVisible();
    const elsewhere = screen.getByRole("button", { name: "Review another control" });
    elsewhere.focus();
    await act(async () => { finish(); await pending; });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirm Changes action" })).toBeNull());
    expect(elsewhere).toHaveFocus();
  });
});
