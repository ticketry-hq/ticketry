import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DormantWorkspaceTabs } from "../app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs";

describe("overhaul acceptance - dormant workspace tabs", () => {
  it("[overhaul-274] folds dormant chips into one bounded dropdown at the tab strip end", () => {
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

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dormant-tabs-trigger"));

    const menu = screen.getByRole("menu", { name: "Dormant tabs" });
    expect(menu).toHaveClass("max-h-[60vh]", "overflow-y-auto");
    expect(screen.getAllByRole("menuitem", { name: /^Reopen / })).toHaveLength(18);
  });
});
