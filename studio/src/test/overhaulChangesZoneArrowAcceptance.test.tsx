import { fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { ChangedFilesList } from "../features/agents/worktrees/changes/ChangedFilesList";
import { ChangesToolbar } from "../features/agents/worktrees/changes/ChangesToolbar";
import { DiffReadingRegion } from "../features/agents/worktrees/changes/DiffReadingRegion";
import {
  useChangesActions,
  type ChangesCommands,
} from "../features/agents/worktrees/changes/useChangesActions";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio } from "./seam";

const files = [
  { path: "src/a.ts", status: "modified" },
  { path: "README.md", status: "deleted" },
];

describe("overhaul acceptance - Changes arrow hops between zones", () => {
  it.each([false, true])("[overhaul-357] navigates command and review sections with PR link: %s", async (hasPullRequest) => {
    Element.prototype.scrollIntoView = vi.fn();
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    const commands: ChangesCommands = {
      branch: "main",
      dirty: false,
      unpushedCount: 0,
      pullRequestUrl: hasPullRequest ? "https://example.com/pull/1" : null,
      onCommit: async () => undefined,
      onPush: async () => undefined,
    };

    function Harness() {
      const actions = useChangesActions(commands);
      return (
        <div data-testid="changes-workspace-scroll">
          <ChangesToolbar
            actions={actions}
            moduleId="module-1"
            selectedTaskId={null}
            onOpenModule={() => undefined}
            onOpenTask={() => undefined}
          />
          <div data-testid="changes-files-column">
            <ChangedFilesList
              checkoutKey="module:one"
              files={files}
              label="Module changed files"
              descriptionPrefix="module-one"
              selectedPath="README.md"
            />
          </div>
          <DiffReadingRegion>diff</DiffReadingRegion>
        </div>
      );
    }

    mountStudio({
      http,
      children: <Harness />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "CurrentWorktrees") {
          return { worktrees: { __typename: "WorktreesConnection", nodes: [] } } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });
    const keymap = renderHook(() => useGlobalKeymap());
    const trigger = screen.getByRole("button", { name: "Choose checkout" });
    await waitFor(() => expect(trigger).toHaveFocus());
    const readme = screen.getByRole("button", { name: "README.md" });
    const src = screen.getByRole("button", { name: "src" });
    const diff = screen.getByRole("region", { name: "File diff content" });
    const branch = screen.getByRole("button", { name: "Branch" });

    // The top section moves horizontally and skips unavailable commands.
    expect(screen.getByRole("toolbar", { name: "Changes commands" })).toContainElement(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    if (hasPullRequest) {
      const link = screen.getByRole("link", { name: "Open PR" });
      expect(link).toHaveFocus();
      fireEvent.keyDown(link, { key: "ArrowRight" });
    }
    expect(branch).toHaveFocus();
    fireEvent.keyDown(branch, { key: "ArrowRight" });
    expect(branch).toHaveFocus();
    fireEvent.keyDown(branch, { key: "ArrowLeft" });
    if (hasPullRequest) {
      const link = screen.getByRole("link", { name: "Open PR" });
      expect(link).toHaveFocus();
      fireEvent.keyDown(link, { key: "ArrowLeft" });
    }
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "ArrowRight", metaKey: true });
    expect(trigger).toHaveFocus();

    // Down from the toolbar lands on the selected file, not merely the first row.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(readme).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(readme, { key: "ArrowRight" });
    expect(diff).toHaveFocus();
    fireEvent.keyDown(diff, { key: "ArrowLeft" });
    expect(readme).toHaveFocus();
    fireEvent.keyDown(readme, { key: "ArrowRight" });
    fireEvent.keyDown(diff, { key: "ArrowUp" });
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(readme).toHaveFocus();

    // Right on a directory still expands or collapses; it never leaves the tree.
    fireEvent.keyDown(readme, { key: "Home" });
    expect(src).toHaveFocus();
    fireEvent.keyDown(src, { key: "ArrowRight" });
    expect(src).toHaveFocus();
    fireEvent.keyDown(src, { key: "ArrowUp" });
    expect(trigger).toHaveFocus();

    // Branch button is part of the toolbar too, so Down works from any control.
    branch.focus();
    fireEvent.keyDown(branch, { key: "ArrowDown" });
    expect(readme).toHaveFocus();
    keymap.unmount();
  });
});
