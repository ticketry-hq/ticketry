import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocViewer from "../app/shell/ticket-workspace/selected-ticket/documents/DocViewer";
import type { DesignDoc } from "../features/agents/types";

vi.mock("../app/shell/ticket-workspace/selected-ticket/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label="Document content"
      defaultValue={markdown}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const DESIGN: DesignDoc = {
  id: "design",
  rel_path: "DESIGN.md",
  label: "Design",
};
const NOTES: DesignDoc = {
  id: "notes",
  rel_path: "NOTES.md",
  label: "Notes",
};

function DocumentTabs() {
  const [active, setActive] = useState(DESIGN.id);
  return (
    <>
      <div role="tablist" aria-label="Documents">
        {[DESIGN, NOTES].map((doc) => (
          <button
            key={doc.id}
            type="button"
            role="tab"
            aria-selected={active === doc.id}
            onClick={() => setActive(doc.id)}
          >
            {doc.label}
          </button>
        ))}
      </div>
      <div hidden={active !== DESIGN.id}>
        <DocViewer doc={DESIGN} editable />
      </div>
      <div hidden={active !== NOTES.id}>
        <DocViewer doc={NOTES} />
      </div>
    </>
  );
}

describe("overhaul acceptance — documents and persisted layout", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("DESIGN.md") ? "# Design" : "# Notes";
        return Promise.resolve(
          new Response(body, { headers: { ETag: '"revision-1"' } }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("[overhaul-11] preserves an unsaved document buffer while switching tabs", async () => {
    render(<DocumentTabs />);
    fireEvent.change(await screen.findByLabelText("Document content"), {
      target: { value: "# Unsaved design" },
    });
    expect(screen.getByText("Unsaved changes")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(await screen.findByRole("heading", { name: "Notes" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));

    expect(screen.getByLabelText("Document content")).toHaveValue(
      "# Unsaved design",
    );
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("[overhaul-12] restores sidebar, panel layout, expansion, and collapsed sections after reload", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const first = await import("../state/clientStore");

    first.useClientStore.getState().toggleSidebar();
    first.useClientStore.getState().setPanelLayout([18, 32, 50]);
    first.useClientStore.getState().toggleExpanded("module-1", "story-1");
    first.useClientStore.getState().toggleStateCollapsed("review");
    vi.advanceTimersByTime(400);

    vi.resetModules();
    const reloaded = await import("../state/clientStore");
    const state = reloaded.useClientStore.getState();

    expect(state.sidebarVisible).toBe(false);
    expect(state.panelLayout).toEqual([18, 32, 50]);
    expect(state.expandedIdsByModule).toEqual({ "module-1": ["story-1"] });
    expect(state.collapsedStateIds).toEqual(new Set(["review"]));
  });
});
