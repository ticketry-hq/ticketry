import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import WorkItemSearchList from "./WorkItemSearchList";

const task = (id: string, sequence_id: number, name: string) =>
  ({ id, sequence_id, name, key: `T-${sequence_id}` }) as never;

describe("WorkItemSearchList", () => {
  it("filters tasks by number, key, or name and selects one", () => {
    const onSelect = vi.fn();
    const close = vi.fn();
    render(
      <WorkItemSearchList
        tasks={[task("a", 7, "Alpha"), task("b", 12, "Beta")]}
        value={null}
        onSelect={onSelect}
        close={close}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "12" } });
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.click(screen.getByText("Beta"));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(close).toHaveBeenCalled();
  });

  it("shows the empty option only when provided and the query is blank", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <WorkItemSearchList tasks={[]} value={null} onSelect={onSelect} close={() => {}} />,
    );
    expect(screen.queryByText("No parent")).toBeNull();
    rerender(
      <WorkItemSearchList
        tasks={[]}
        value={null}
        onSelect={onSelect}
        close={() => {}}
        emptyLabel="No parent"
      />,
    );
    fireEvent.click(screen.getByText("No parent"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
