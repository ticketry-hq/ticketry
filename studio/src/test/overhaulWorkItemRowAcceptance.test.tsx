import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";

describe("overhaul acceptance — work-item rows", () => {
  it("[overhaul-33] reads rows as one left-aligned identifier · name label", async () => {
    const http = fixture();
    const implementation = {
      id: "implementation",
      name: "Implementation",
      level: "task" as const,
      color: null,
      sort_order: 2,
    };
    const active = {
      id: "active",
      name: "Implement",
      group: "started",
      color: "#5b8def",
      sort_order: 2,
    };
    http.tree("module-1", {
      rootIds: ["story-1", "unresolved-1"],
      children: {
        "story-1": ["implementation-1"],
        "implementation-1": [],
        "unresolved-1": [],
      },
      order: ["story-1", "implementation-1", "unresolved-1"],
    });
    const unresolvedWorkItem = workItem({
      id: "unresolved-1",
      name: "Unresolved work item",
      key: "MEML-UNRESOLVED",
      state: active,
    });
    Reflect.deleteProperty(unresolvedWorkItem, "sequence_id");
    http.workItems([
      workItem({
        id: "story-1",
        name: "A deliberately long Story title that must yield space to its key",
        key: "MEML-CANONICAL-STORY",
        sequence_id: 33,
        state: active,
        sub_issues_count: 1,
      }),
      workItem({
        id: "implementation-1",
        name: "Implementation child",
        key: "MEML-CANONICAL-IMPLEMENTATION",
        sequence_id: 34,
        parent_id: "story-1",
        issue_type: implementation,
        state: active,
      }),
      unresolvedWorkItem,
    ]);
    http.runs("story-1", [
      {
        agent_run_id: "run-story",
        task_id: "story-1",
        module_id: "module-1",
        scope: "task",
        state: "working",
        started_at: "2026-08-09T12:00:00Z",
        updated_at: "2026-08-09T12:00:00Z",
      },
    ]);
    mountStudio({ http });

    const stories = await screen.findByRole("region", { name: "Stories" });
    const scratch = within(stories).getByRole("treeitem", {
      name: /Local scratch workspace/,
    });
    expect(scratch.querySelector("[data-task-id-token]")).toBeNull();
    expect(scratch.lastElementChild).toHaveTextContent("Local scratch workspace");
    const unresolved = within(stories).getByRole("treeitem", {
      name: /Unresolved work item/,
    });
    expect(unresolved.querySelector("[data-task-id-token]")).toBeNull();
    expect(unresolved).not.toHaveTextContent(/T-(null|undefined)/);
    expect(unresolved).not.toHaveTextContent("MEML-UNRESOLVED");
    // No identifier resolves, so the label is the bare name — no separator.
    expect(unresolved).not.toHaveTextContent("·");
    expect(
      unresolved.querySelector("[data-task-label]"),
    ).toHaveTextContent(/^Unresolved work item$/);

    const parent = await within(stories).findByRole("treeitem", {
      name: /A deliberately long Story title/,
    });
    http.notifications.runLifecycle(
      "run-story",
      "working",
      "2026-08-09T12:00:01Z",
    );
    const title = within(parent).getByText(
      "A deliberately long Story title that must yield space to its key",
    );
    const status = await within(parent).findByTestId("agent-state-badge");
    const key = within(parent).getByText("T-33");
    const label = parent.querySelector("[data-task-label]");
    // Caret, then the one combined label, then trailing operational status.
    expect([...parent.children]).toEqual([
      expect.any(HTMLElement),
      label,
      status,
    ]);
    // Identifier and name are one left-aligned unit that truncates together.
    expect(label).toContainElement(key);
    expect(label).toContainElement(title);
    expect(label).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(label).toHaveTextContent(
      "T-33 · A deliberately long Story title that must yield space to its key",
    );
    expect(key.compareDocumentPosition(title))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Workflow-state color lands on the identifier token alone.
    expect(key).toHaveStyle({ color: "#5b8def" });
    expect(title).not.toHaveStyle({ color: "#5b8def" });
    // The status badge is a sibling of the label, so it stays visible.
    expect(status.parentElement).toBe(parent);

    fireEvent.click(parent);
    expect(parent).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(parent).getByRole("button", { name: "Expand subtasks" }));

    const child = await within(stories).findByRole("treeitem", {
      name: /Implementation child/,
    });
    const childTitle = within(child).getByText("Implementation child");
    const childKey = within(child).getByText("T-34");
    const childLabel = child.querySelector("[data-task-label]");
    // Nested rows keep the same reading order and indentation as root rows.
    expect(childLabel).toContainElement(childKey);
    expect(childLabel).toContainElement(childTitle);
    expect(child.children[1]).toBe(childLabel);
    expect(childLabel).toHaveTextContent("T-34 · Implementation child");
    expect(childLabel).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(child).toHaveStyle({ paddingLeft: "2ch" });

    const search = within(stories).getByRole("textbox", { name: "Search stories" });
    fireEvent.change(search, { target: { value: "MEML-34" } });
    expect(await within(stories).findByText("Implementation child")).toBeVisible();
    expect(within(stories).getByText("T-34")).toBeVisible();
    expect(stories).not.toHaveTextContent("MEML-34");

    fireEvent.change(search, { target: { value: "34" } });
    expect(await within(stories).findByText("Implementation child")).toBeVisible();
    expect(within(stories).getByText("T-34")).toBeVisible();

    fireEvent.change(search, { target: { value: "Implementation child" } });
    expect(await within(stories).findByText("Implementation child")).toBeVisible();
    expect(within(stories).getByText("T-34")).toBeVisible();
  });
});
