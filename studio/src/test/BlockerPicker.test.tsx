import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import BlockerPicker from "../features/work-items/fields/BlockerPicker";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import type { WorkItem } from "../shared/api/types";

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    name: partial.id,
    project_id: "p1",
    sequence_id: 1,
    state: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    key: `MEML-${partial.id}`,
    ...partial,
    issue_type: partial.issue_type ?? { id: "type-task", name: "Task", level: "task" },
  };
}

beforeEach(() => {
  useBacklogStore.setState({ projectId: "p1", items: [], states: [] });
});

describe("BlockerPicker", () => {
  it("excludes self, current blockers, and cycle-creating candidates", () => {
    const a = wi({ id: "a", key: "MEML-1", blocks_ids: ["c"] }); // a blocks c
    const b = wi({ id: "b", key: "MEML-2" });
    const c = wi({ id: "c", key: "MEML-3" });
    const existing = wi({ id: "x", key: "MEML-9" });
    useBacklogStore.setState({ items: [a, b, c, existing] });

    render(
      <BlockerPicker issueId="a" currentIds={["x"]} onPick={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("blocker-picker").querySelector("button")!);

    // b is the only eligible candidate: a=self, c=cycle (a blocks c), x=current.
    expect(screen.getByText("MEML-2")).toBeInTheDocument();
    expect(screen.queryByText("MEML-1")).toBeNull();
    expect(screen.queryByText("MEML-3")).toBeNull();
    expect(screen.queryByText("MEML-9")).toBeNull();
  });

  it("calls onPick with the chosen candidate id", () => {
    const a = wi({ id: "a", key: "MEML-1" });
    const b = wi({ id: "b", key: "MEML-2" });
    useBacklogStore.setState({ items: [a, b] });
    const onPick = vi.fn();

    render(<BlockerPicker issueId="a" currentIds={[]} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("blocker-picker").querySelector("button")!);
    fireEvent.click(screen.getByText("MEML-2"));
    expect(onPick).toHaveBeenCalledWith("b");
  });
});
