import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FooterChangesToggle } from "../app/shell/FooterChangesToggle";
import {
  ChangesWorkspace,
  useChangesWorkspace,
} from "../features/agents/worktrees";
import { scratchBucketId } from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import {
  getModuleTreeSnapshot,
  WorkTrackerModuleOpenDocument,
} from "../features/work-items";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { studioApolloClient } from "../shared/apollo/client";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const MODULE_ID = "module-1";
const ORIGIN_TASK_ID = "removed-origin";
const SURVIVING_TASK_ID = "surviving-task";

function resetChangesWorkspace(): void {
  useChangesWorkspace.setState({
    active: false,
    moduleId: null,
    taskId: null,
    origin: null,
    taskIdByModule: {},
  });
}

describe("overhaul acceptance, Changes workspace recovery", () => {
  beforeEach(resetChangesWorkspace);

  it("[overhaul-327] returns a removed origin to the same module's scratch Details workspace", async () => {
    const http = fixture();
    http.tree(MODULE_ID, {
      rootIds: [ORIGIN_TASK_ID, SURVIVING_TASK_ID],
      children: { [ORIGIN_TASK_ID]: [], [SURVIVING_TASK_ID]: [] },
      order: [ORIGIN_TASK_ID, SURVIVING_TASK_ID],
    });
    http.workItems([
      workItem({ id: ORIGIN_TASK_ID, parent_id: MODULE_ID, sequence_id: 1970 }),
      workItem({ id: SURVIVING_TASK_ID, parent_id: MODULE_ID, sequence_id: 1971 }),
    ]);

    mountStudio({
      http,
      selectedTaskId: ORIGIN_TASK_ID,
      children: <FooterChangesToggle />,
    });
    await waitFor(() =>
      expect(getModuleTreeSnapshot("project-1", MODULE_ID).order).toContain(
        ORIGIN_TASK_ID,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    http.tree(MODULE_ID, {
      rootIds: [SURVIVING_TASK_ID],
      children: { [SURVIVING_TASK_ID]: [] },
      order: [SURVIVING_TASK_ID],
    });
    await act(async () => {
      await studioApolloClient().query({
        query: WorkTrackerModuleOpenDocument,
        variables: { moduleId: compactWorktrackerId(MODULE_ID) },
        fetchPolicy: "network-only",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Back to planning workspace" }),
    );

    const scratchBucket = scratchBucketId(MODULE_ID);
    expect(useClientStore.getState()).toMatchObject({
      selectedModuleId: MODULE_ID,
      selectedTaskId: TEMP_TASK_ID,
      workspaceSelection: { kind: "task" },
    });
    expect(useClientStore.getState().selectedTaskId).not.toBe(SURVIVING_TASK_ID);
    expect(useClientStore.getState().workspaces[scratchBucket]?.active).toBe(
      "details",
    );
  });

  it.each(["loading", "error"] as const)(
    "[overhaul-328] keeps Back usable while Changes is %s",
    async (result) => {
      const http = fixture();
      http.tree(MODULE_ID, { rootIds: [], children: {}, order: [] });
      const loading = new Promise<never>(() => {});

      mountStudio({
        http,
        children: (
          <>
            <ChangesWorkspace />
            <FooterChangesToggle />
          </>
        ),
        graphQlExecute: async (document, variables) => {
          if (documentOperationName(document) === "ModuleVersionControl") {
            if (result === "loading") return await loading;
            throw new FoundationGraphQlError(
              "storage_unavailable",
              "Changes could not be loaded.",
            );
          }
          return http.executeGraphQl(document, variables);
        },
      });

      fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
      if (result === "loading") {
        expect(await screen.findByText("Loading module changes...")).toBeVisible();
      } else {
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Changes could not be loaded.",
        );
      }
      const back = screen.getByRole("button", {
        name: "Back to planning workspace",
      });
      expect(back).toBeEnabled();

      fireEvent.click(back);
      expect(screen.queryByTestId("independent-changes-workspace")).toBeNull();
      expect(screen.getByRole("button", { name: "Open module Changes" }))
        .toBeEnabled();
    },
  );
});
