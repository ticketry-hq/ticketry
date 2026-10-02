import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import RichMarkdownEditor from "../features/documents/RichMarkdownEditor";

it("[overhaul-403] Tab leaves a compact rich description with the caret in prose", async () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const { getByTestId } = render(
    <RichMarkdownEditor
      markdown="Plain description"
      onChange={vi.fn()}
      onParseError={vi.fn()}
      layout="compact"
    />,
  );
  const editable = getByTestId("rich-markdown-editor-shell")
    .querySelector<HTMLElement>("[contenteditable='true']");
  expect(editable).not.toBeNull();
  editable!.focus();

  const paragraph = editable!.querySelector("p");
  expect(paragraph).not.toBeNull();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(paragraph!);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event("selectionchange", { bubbles: true }));

  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  editable!.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
});

it("[overhaul-404] Tab still indents a list item in a compact rich description", () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const { getByTestId } = render(
    <RichMarkdownEditor
      markdown="- List item"
      onChange={vi.fn()}
      onParseError={vi.fn()}
      layout="compact"
    />,
  );
  const editable = getByTestId("rich-markdown-editor-shell")
    .querySelector<HTMLElement>("[contenteditable='true']");
  expect(editable).not.toBeNull();
  editable!.focus();

  const item = editable!.querySelector("li");
  expect(item).not.toBeNull();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(item!);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event("selectionchange", { bubbles: true }));

  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  editable!.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
});
