import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ModuleVersionControl } from "../features/agents/worktrees/changes/ModuleVersionControl";
import { useBranchInspector } from "../features/agents/worktrees/changes/branchInspectorState";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio } from "./seam";

describe("overhaul acceptance - Changes branch keyboard", () => {
  beforeEach(() => useBranchInspector.setState({ open: false, sections: {} }));

  it("[overhaul-346] focuses Close and returns Escape and disclosure collapse to stable controls", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({
      http,
      children: (
        <ModuleVersionControl
          moduleId="module-1"
          active
          onOpenModule={() => undefined}
          onOpenTask={() => undefined}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "CurrentWorktrees") {
          return { worktrees: { __typename: "WorktreesConnection", nodes: [] } } as never;
        }
        if (operation === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              checkout: {
                __typename: "ModuleCheckoutChangesView",
                available: true,
                reason: null,
                branch: "feature/keyboard",
                default_branch: "main",
                committed_count: 0,
                pull_request_creation_eligible: false,
                baseline: "origin/main",
                baseline_kind: "upstream",
                clean: false,
                dirty: true,
                unpushed_count: 1,
                truncated: false,
                files: [],
                insertions: 0,
                deletions: 0,
              },
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const branch = await screen.findByRole("button", { name: "Branch" });
    fireEvent.click(branch);
    const inspector = await screen.findByRole("complementary", { name: "Branch inspector" });
    await waitFor(() => expect(within(inspector).getByRole("button", { name: "Close branch inspector" })).toHaveFocus());

    const status = within(inspector).getByText("Status", { selector: "summary" });
    const commit = within(inspector).getByRole("button", { name: "Commit" });
    commit.focus();
    fireEvent.click(status);
    await waitFor(() => expect(status).toHaveFocus());

    fireEvent.keyDown(inspector, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Branch inspector" })).toBeNull();
    await waitFor(() => expect(branch).toHaveFocus());
  });
});
