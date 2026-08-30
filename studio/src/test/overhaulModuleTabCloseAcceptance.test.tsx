import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModuleTab } from "../app/shell/ticket-workspace/ModuleTab";
import type { Module } from "../shared/api/types";

const MODULE: Module = {
  id: "module-1",
  name: "Ticketry",
  project_id: "project-1",
  key: "PRJ-1",
  sequence_id: 1,
  is_archived: false,
  issue_type: "module-type",
};

describe("module tab close acceptance", () => {
  it("[overhaul-183] keeps the close hover background to a compact square inside the tab", () => {
    render(
      <ModuleTab
        module={MODULE}
        isSelected
        dropIntent={null}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        registerRef={vi.fn()}
      />,
    );

    const close = screen.getByRole("button", { name: "Hide Ticketry tab" });
    const closeBackground = close.querySelector("span");

    expect(close).toHaveClass("h-full", "w-7");
    expect(close).not.toHaveClass("hover:bg-pane-bg");
    expect(closeBackground).toHaveClass(
      "size-4",
      "group-hover/close:bg-pane-bg",
      "group-hover/close:text-text-primary",
    );
  });
});
