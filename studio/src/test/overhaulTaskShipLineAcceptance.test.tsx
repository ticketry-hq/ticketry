import {
  CheckoutKindEnum,
  PrStateEnum,
  ShipStepOutcomeStatusEnum,
  type ShipRecord,
} from "@worktracker/typescript-sdk/models";
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const done = { status: ShipStepOutcomeStatusEnum.done, message: null };
const skipped = { status: ShipStepOutcomeStatusEnum.skipped, message: null };

function shipRecord(
  id: string,
  taskId: string,
  actionAt: string,
  prNumber: number | null,
  overrides: Partial<Pick<ShipRecord, "pr_url" | "pr_number">> = {},
): ShipRecord {
  return {
    id,
    action_id: `action-${id}`,
    module_id: "module-1",
    task_id: taskId,
    checkout_kind: CheckoutKindEnum.worktree,
    checkout_name: "Task worktree",
    branch: "CODIN-1045-task-ship-line",
    commit_shas: ["a".repeat(40)],
    commit_outcome: done,
    push_outcome: done,
    create_pr_outcome: prNumber === null ? skipped : done,
    pr_url: prNumber === null
      ? null
      : `https://github.com/ticketry-hq/ticketry/pull/${prNumber}`,
    pr_number: prNumber,
    pr_state: prNumber === null ? null : PrStateEnum.open,
    action_at: actionAt,
    pr_refreshed_at: null,
    ...overrides,
  };
}

describe("overhaul acceptance — Task ship line", () => {
  it("[overhaul-181] keeps the latest useful shipped PR in Details", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["archived-task", "no-pr-task"],
      children: { "archived-task": [], "no-pr-task": [] },
      order: ["archived-task", "no-pr-task"],
    });
    http.workItems([
      workItem({
        id: "archived-task",
        name: "Archived shipped task",
        is_archived: true,
      }),
      workItem({ id: "no-pr-task", name: "Task without a PR" }),
    ]);

    const now = Date.now();
    http.shipRecords("archived-task", [
      shipRecord(
        "newer-missing-number",
        "archived-task",
        new Date(now - 10 * 60_000).toISOString(),
        null,
        {
          pr_url: "https://github.com/ticketry-hq/ticketry/pull/45",
        },
      ),
      shipRecord(
        "newer-unsafe-url",
        "archived-task",
        new Date(now - 20 * 60_000).toISOString(),
        44,
        { pr_url: "javascript:alert('nope')" },
      ),
      shipRecord(
        "newer-invalid-time",
        "archived-task",
        "not-a-date",
        43,
      ),
      shipRecord(
        "newer-partial",
        "archived-task",
        new Date(now - 30 * 60_000).toISOString(),
        null,
      ),
      shipRecord(
        "latest-pr",
        "archived-task",
        new Date(now - 2 * 60 * 60_000).toISOString(),
        42,
      ),
      shipRecord(
        "older-pr",
        "archived-task",
        new Date(now - 24 * 60 * 60_000).toISOString(),
        41,
      ),
    ]);
    http.shipRecords("no-pr-task", [
      shipRecord(
        "partial-only",
        "no-pr-task",
        new Date(now - 10 * 60_000).toISOString(),
        null,
      ),
    ]);

    mountStudio({ http, selectedTaskId: "archived-task" });

    const details = screen.getByRole("region", { name: "Details" });
    const shipped = await within(details).findByTestId("task-ship-line");
    expect(shipped).toHaveTextContent("Shipped: PR #42 · 2h ago");
    expect(shipped).not.toHaveTextContent("PR #41");

    const link = within(shipped).getByRole("link", { name: "Open PR #42" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/42",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    act(() => useClientStore.setState({ selectedTaskId: "no-pr-task" }));

    expect(await within(details).findByText("Task without a PR")).toBeVisible();
    expect(within(details).queryByTestId("task-ship-line")).toBeNull();

    http.shipRecords("archived-task", [
      shipRecord(
        "newly-landed-pr",
        "archived-task",
        new Date(now - 5 * 60_000).toISOString(),
        43,
      ),
    ]);

    act(() => useClientStore.setState({ selectedTaskId: "archived-task" }));

    expect(await within(details).findByText("Archived shipped task")).toBeVisible();
    expect(
      await within(details).findByRole("link", { name: "Open PR #43" }),
    ).toBeVisible();
    const refreshedShip = await within(details).findByTestId("task-ship-line");
    expect(refreshedShip).toHaveTextContent("Shipped: PR #43 · 5m ago");
  });
});
