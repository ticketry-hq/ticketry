import { describe, expect, it } from "vitest";
import {
  orderVisibleWorkspaceTabs,
  prepareWorkspaceTabOrderWrite,
  reorderVisibleWorkspaceTabs,
} from "./ordering";

describe("workspace tab ordering", () => {
  it("moves any identity to either edge and ignores no-op drops", () => {
    const order = [
      { kind: "details" as const },
      { kind: "doc" as const, id: "design" },
      { kind: "terminal" as const, id: "run-1" },
    ];

    expect(reorderVisibleWorkspaceTabs(
      order,
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      "near",
    )).toEqual([
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      { kind: "doc", id: "design" },
    ]);
    expect(reorderVisibleWorkspaceTabs(
      order,
      { kind: "details" },
      { kind: "doc", id: "design" },
      "near",
    )).toBeNull();
  });

  it("puts saved visible identities first and appends omitted tabs in default order", () => {
    const visible = [
      { kind: "details" as const },
      { kind: "doc" as const, id: "design" },
      { kind: "doc" as const, id: "notes" },
      { kind: "terminal" as const, id: "terminal-1" },
    ];

    expect(orderVisibleWorkspaceTabs(visible, [
      { kind: "terminal", id: "terminal-1" },
      { kind: "doc", id: "deleted" },
      { kind: "details" },
    ])).toEqual([
      { kind: "terminal", id: "terminal-1" },
      { kind: "details" },
      { kind: "doc", id: "design" },
      { kind: "doc", id: "notes" },
    ]);
  });

  it("prunes stale identities while retaining known closed and dismissed tabs", () => {
    expect(prepareWorkspaceTabOrderWrite(
      [
        { kind: "terminal", id: "visible-terminal" },
        { kind: "details" },
      ],
      [
        { kind: "doc", id: "closed-doc" },
        { kind: "details" },
        { kind: "doc", id: "deleted-doc" },
        { kind: "terminal", id: "visible-terminal" },
        { kind: "terminal", id: "dismissed-terminal" },
      ],
      [
        { kind: "details" },
        { kind: "doc", id: "closed-doc" },
        { kind: "terminal", id: "visible-terminal" },
        { kind: "terminal", id: "dismissed-terminal" },
      ],
    )).toEqual([
      { kind: "doc", id: "closed-doc" },
      { kind: "terminal", id: "visible-terminal" },
      { kind: "details" },
      { kind: "terminal", id: "dismissed-terminal" },
    ]);
  });
});
