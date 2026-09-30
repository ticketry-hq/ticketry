import { describe, expect, it } from "vitest";
import {
  orderVisibleWorkspaceTabs,
  prepareWorkspaceTabOrderWrite,
  reorderVisibleWorkspaceTabs,
} from "./ordering";
import { workspaceTabOrderFromJson } from "./types";

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

  it("applies saved precedence and appends omitted visible tabs", () => {
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

  it("retains known hidden tabs and prunes stale identities on write", () => {
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
        { kind: "terminal", id: "dormant-terminal" },
      ],
      [
        { kind: "details" },
        { kind: "doc", id: "closed-doc" },
        { kind: "terminal", id: "visible-terminal" },
        { kind: "terminal", id: "dormant-terminal" },
      ],
    )).toEqual([
      { kind: "doc", id: "closed-doc" },
      { kind: "terminal", id: "visible-terminal" },
      { kind: "details" },
      { kind: "terminal", id: "dormant-terminal" },
    ]);
  });

  it("rejects malformed and duplicate JSON identities", () => {
    expect(workspaceTabOrderFromJson([
      { kind: "details" },
      { kind: "terminal", id: "run-1" },
    ]).order).toHaveLength(2);
    expect(workspaceTabOrderFromJson([
      { kind: "details" },
      { kind: "details" },
    ])).toEqual({ order: [] });
    expect(workspaceTabOrderFromJson([{ kind: "doc", id: "" }]))
      .toEqual({ order: [] });
  });
});
