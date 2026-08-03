import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import ParentPicker from "../app/shell/ticket-workspace/selected-ticket/details/fields/ParentPicker";
import { useStudioStore } from "../features/projects/store";
import { seedModules } from "../features/projects";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import type { Module } from "../shared/api/types";

function mod(partial: Partial<Module> & { id: string }): Module {
  return {
    name: partial.id,
    project_id: "p1",
    sequence_id: 1,
    key: `MEML-${partial.id}`,
    ...partial,
    issue_type: partial.issue_type ?? { id: "type-module", name: "Module", level: "module" },
  };
}

beforeEach(() => {
  useStudioStore.setState({ selectedProjectId: "p1" });
  seedModules("p1", []);
  useBacklogStore.setState({ projectId: "p1", items: [], states: [] });
});

function open() {
  fireEvent.click(screen.getByTestId("parent-picker").querySelector("button")!);
}

describe("ParentPicker search", () => {
  it("filters epics by sequence number", () => {
    const a = mod({ id: "a", key: "MEML-7", name: "Alpha epic", sequence_id: 7 });
    const b = mod({ id: "b", key: "MEML-42", name: "Beta epic", sequence_id: 42 });
    useStudioStore.setState({ selectedProjectId: "p1" });
  seedModules("p1", [a, b]);

    render(<ParentPicker value={null} onChange={() => {}} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "42" },
    });

    expect(screen.getByText("Beta epic")).toBeInTheDocument();
    expect(screen.queryByText("Alpha epic")).toBeNull();
  });

  it("filters by key and by name too", () => {
    const a = mod({ id: "a", key: "MEML-7", name: "Alpha epic", sequence_id: 7 });
    const b = mod({ id: "b", key: "MEML-42", name: "Beta epic", sequence_id: 42 });
    useStudioStore.setState({ selectedProjectId: "p1" });
  seedModules("p1", [a, b]);

    render(<ParentPicker value={null} onChange={() => {}} />);
    open();

    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "meml-7" } });
    expect(screen.getByText("Alpha epic")).toBeInTheDocument();
    expect(screen.queryByText("Beta epic")).toBeNull();

    fireEvent.change(input, { target: { value: "beta" } });
    expect(screen.getByText("Beta epic")).toBeInTheDocument();
    expect(screen.queryByText("Alpha epic")).toBeNull();
  });

  it("picks the matched epic", () => {
    const a = mod({ id: "a", key: "MEML-7", name: "Alpha epic", sequence_id: 7 });
    useStudioStore.setState({ selectedProjectId: "p1" });
  seedModules("p1", [a]);
    const onChange = vi.fn();

    render(<ParentPicker value={null} onChange={onChange} />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByText("Alpha epic"));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
