import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChangesToolbar } from "../features/agents/worktrees/changes/ChangesToolbar";
import {
  useChangesActions,
  type ChangesCommands,
} from "../features/agents/worktrees/changes/useChangesActions";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { fixture, mountStudio } from "./seam";

describe("overhaul acceptance - checkout switcher when worktrees fail to load", () => {
  it("[overhaul-397] shows the checkout-list failure and still opens the module checkout", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    const onOpenModule = vi.fn();
    const onOpenTask = vi.fn();
    const commands: ChangesCommands = {
      branch: "wt/task-a",
      dirty: false,
      unpushedCount: 0,
      onCommit: async () => undefined,
      onPush: async () => undefined,
    };

    function Harness() {
      const actions = useChangesActions(commands);
      return (
        <ChangesToolbar
          actions={actions}
          moduleId="module-1"
          selectedTaskId="task-a"
          onOpenModule={onOpenModule}
          onOpenTask={onOpenTask}
        />
      );
    }

    mountStudio({
      http,
      children: <Harness />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "CurrentWorktrees") {
          throw new FoundationGraphQlError("storage_unavailable", "Worktrees unavailable.");
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const trigger = screen.getByRole("button", { name: "Choose checkout" });
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load worktree checkouts.");
    const moduleRow = screen.getByRole("option", { name: "Open Module checkout Changes" });
    await waitFor(() => expect(moduleRow).toHaveFocus());

    fireEvent.keyDown(moduleRow, { key: "Enter" });
    expect(onOpenModule).toHaveBeenCalledTimes(1);
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
