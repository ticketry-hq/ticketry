import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DormantWorkspaceTabs } from "../app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs";

describe("overhaul acceptance - dormant workspace tabs", () => {
  it("[overhaul-274] keeps dormant chips in a bounded scroll owner above the active tab", () => {
    const closedDocuments = Array.from({ length: 18 }, (_, index) => ({
      id: `document-${index + 1}`,
      rel_path: `spec/document-${index + 1}.md`,
      label: `Document ${index + 1}`,
    }));

    render(
      <DormantWorkspaceTabs
        closedDocuments={closedDocuments}
        resumableChips={[]}
        historyChips={[]}
        resumableSessions={[]}
        resumingRunIds={new Set()}
        onReopenDocument={vi.fn()}
        onResumeTerminal={vi.fn()}
      />,
    );

    const firstChip = screen.getByRole("button", {
      name: "Reopen Document 1",
    });
    const chipScroller = firstChip.parentElement;

    expect(chipScroller).not.toBeNull();
    expect(chipScroller).toHaveClass(
      "max-h-[25%]",
      "shrink-0",
      "overflow-y-auto",
    );
    expect(chipScroller?.children).toHaveLength(18);
  });
});
