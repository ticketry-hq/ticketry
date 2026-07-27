import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RichMarkdownEditor from "../features/documents/RichMarkdownEditor";

describe("RichMarkdownEditor", () => {
  it("keeps editor layout classes off the popup layer", () => {
    const { getByTestId } = render(
      <RichMarkdownEditor
        markdown="# Visible document"
        onChange={vi.fn()}
        onParseError={vi.fn()}
      />,
    );

    expect(getByTestId("rich-markdown-editor-shell")).toHaveClass(
      "min-h-[60vh]",
      "rounded-lg",
      "border-pane-border",
      "bg-pane-panel",
    );

    const popup = document.querySelector(".mdxeditor-popup-container");
    expect(popup).toBeInTheDocument();
    expect(popup).not.toHaveClass(
      "min-h-[60vh]",
      "rounded-lg",
      "border-pane-border",
      "bg-pane-panel",
    );

    expect(document.querySelector(".mdxeditor-toolbar")).toHaveClass(
      "sticky",
      "top-0",
    );
  });

  it("uses ticket-sized spacing and height in compact layout", () => {
    const { getByTestId } = render(
      <RichMarkdownEditor
        markdown=""
        onChange={vi.fn()}
        onParseError={vi.fn()}
        layout="compact"
      />,
    );

    const shell = getByTestId("rich-markdown-editor-shell");
    expect(shell).toHaveClass("min-h-[12rem]");
    expect(shell).not.toHaveClass("min-h-[60vh]");
    expect(shell.querySelector("[contenteditable=true]")).toHaveClass(
      "min-h-[10rem]",
      "px-3",
      "py-3",
    );
  });

  it("renders code blocks with the dark CodeMirror theme applied", async () => {
    const { getByTestId } = render(
      <RichMarkdownEditor
        markdown={"# Title\n\n```\nprovider emits a hook event\n```\n"}
        onChange={vi.fn()}
        onParseError={vi.fn()}
      />,
    );

    // A duplicated @codemirror/state instance makes CodeMirror reject the
    // theme extension and render nothing, so asserting on the code text is
    // what guards the dark theme wiring.
    await waitFor(() => {
      expect(
        getByTestId("rich-markdown-editor-shell").querySelector(".cm-content")
          ?.textContent,
      ).toContain("provider emits a hook event");
    });
  });
});
