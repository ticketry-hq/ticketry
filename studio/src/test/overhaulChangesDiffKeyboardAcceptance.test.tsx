import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChangesFileReview } from "../features/agents/worktrees/changes/ChangesFileReview";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { fixture, mountStudio } from "./seam";

const patchSuspense = vi.hoisted(() => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { ready: false, promise, resolve };
});

vi.mock("../features/agents/worktrees/changes/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => {
    if (!patchSuspense.ready) throw patchSuspense.promise;
    return <div data-testid="highlighted-patch">{patch}</div>;
  },
}));

const FILE = {
  path: "src/long-line.ts",
  previous_path: null,
  status: "modified",
  binary: false,
  insertions: 1,
  deletions: 1,
};
const SECOND_FILE = {
  ...FILE,
  path: "src/second-line.ts",
};

function mountReview(
  diff: { binary: boolean; patch: string; truncated: boolean } = {
    binary: false,
    patch: "@@ -1 +1 @@\n-old\n+new",
    truncated: false,
  },
  checkoutKey = "task:keyboard-review",
  fail = false,
) {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({
    http,
    children: (
      <div style={{ height: 600, width: 1_000 }}>
        <ChangesFileReview
          checkoutKey={checkoutKey}
          toolbar={<div>Toolbar</div>}
          header={<h2>Keyboard review</h2>}
          taskId="keyboard-review"
          files={[FILE]}
          insertions={1}
          deletions={1}
          truncated={false}
          label="Keyboard review changed files"
          emptyMessage="No changed files."
        />
      </div>
    ),
    graphQlExecute: async (document) => {
      if (documentOperationName(document) === "WorktreeFileDiff") {
        if (fail) throw new FoundationGraphQlError("unknown", "Diff unavailable.");
        return {
          worktree_file_diff: {
            __typename: "FileDiffView",
            path: FILE.path,
            status: FILE.status,
            ...diff,
          },
        } as never;
      }
      return http.executeGraphQl(document, {} as never);
    },
  });
}

describe("overhaul acceptance - Changes diff keyboard reading", () => {
  it("[overhaul-337] keeps one named diff scroll region focused while rendered content replaces its fallback", async () => {
    mountReview();

    fireEvent.click(screen.getByRole("button", { name: FILE.path }));
    const region = screen.getByRole("region", { name: "File diff content" });
    region.focus();
    expect(region).toHaveFocus();

    expect(await screen.findByTestId("raw-patch")).toBeVisible();
    patchSuspense.ready = true;
    patchSuspense.resolve();
    expect(await screen.findByTestId("highlighted-patch")).toBeVisible();
    expect(region).toHaveFocus();
    expect(within(region).getByTestId("highlighted-patch")).toHaveTextContent("+new");
  });

  it("[overhaul-338] scrolls diff overflow with reading keys without activating another control", async () => {
    mountReview();
    fireEvent.click(screen.getByRole("button", { name: FILE.path }));
    const region = screen.getByRole("region", { name: "File diff content" });
    await screen.findByTestId("highlighted-patch");

    Object.defineProperties(region, {
      clientHeight: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollWidth: { configurable: true, value: 1_200 },
    });
    region.focus();

    fireEvent.keyDown(region, { key: "ArrowDown" });
    expect(region.scrollTop).toBe(40);
    fireEvent.keyDown(region, { key: "PageDown" });
    expect(region.scrollTop).toBe(240);
    fireEvent.keyDown(region, { key: "End" });
    expect(region.scrollTop).toBe(800);
    fireEvent.keyDown(region, { key: "PageUp" });
    expect(region.scrollTop).toBe(600);
    fireEvent.keyDown(region, { key: "ArrowUp" });
    expect(region.scrollTop).toBe(560);
    fireEvent.keyDown(region, { key: "Home" });
    expect(region.scrollTop).toBe(0);
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(region.scrollLeft).toBe(40);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(region.scrollLeft).toBe(0);
    expect(region).toHaveFocus();
  });

  it("[overhaul-339] exposes the panel-library separator as a visible keyboard resize stop", async () => {
    mountReview();

    const separator = screen.getByRole("separator", {
      name: "Resize changed files and diff",
    });
    expect(separator).toHaveAttribute("tabindex", "0");
    expect(separator).toHaveClass("focus-visible:bg-focus-accent");
    separator.focus();
    expect(separator).toHaveFocus();

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveFocus();
  });

  it.each([
    ["binary", { binary: true, patch: "", truncated: false }, "Binary file; no text diff is available."],
    ["empty", { binary: false, patch: "", truncated: false }, "No textual changes to display."],
    ["truncated", { binary: false, patch: "+partial", truncated: true }, "This diff is truncated."],
  ] as const)("[overhaul-341] keeps the named region stable for %s diff content", async (state, diff, message) => {
    mountReview(diff, `task:diff-state-${state}`);
    fireEvent.click(screen.getByRole("button", { name: FILE.path }));
    const region = screen.getByRole("region", { name: "File diff content" });
    region.focus();

    expect(await within(region).findByText(message)).toBeVisible();
    expect(region).toHaveFocus();
  });

  it("[overhaul-342] keeps the named region stable when loading the diff fails", async () => {
    mountReview(undefined, "task:diff-state-error", true);
    fireEvent.click(screen.getByRole("button", { name: FILE.path }));
    const region = screen.getByRole("region", { name: "File diff content" });
    region.focus();

    expect(await within(region).findByRole("alert")).toHaveTextContent("Unable to load this file diff.");
    expect(region).toHaveFocus();
  });

  it("[overhaul-340] preserves explicit selection per checkout and wraps Previous and Next without moving focus", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    let releaseFirstDiff: (() => void) | undefined;
    const firstDiffGate = new Promise<void>((resolve) => {
      releaseFirstDiff = resolve;
    });
    const requests: Array<{ operation: string; path: string }> = [];

    function Journey() {
      const [kind, setKind] = useState<"task" | "module">("task");
      return (
        <div style={{ height: 600, width: 1_000 }}>
          <button type="button" onClick={() => setKind((value) => value === "task" ? "module" : "task")}>
            Switch checkout
          </button>
          <ChangesFileReview
            checkoutKey={`${kind}:keyboard-journey`}
            toolbar={<div>Toolbar</div>}
            header={<h2>{kind === "task" ? "Task checkout" : "Module checkout"}</h2>}
            taskId={kind === "task" ? "keyboard-journey" : undefined}
            moduleId={kind === "module" ? "module-1" : undefined}
            files={[FILE, SECOND_FILE]}
            insertions={2}
            deletions={2}
            truncated={false}
            label="Journey changed files"
            emptyMessage="No changed files."
          />
        </div>
      );
    }

    mountStudio({
      http,
      children: <Journey />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeFileDiff" || operation === "ModuleFileDiff") {
          const path = (variables as { path: string }).path;
          requests.push({ operation, path });
          if (requests.length === 1) await firstDiffGate;
          const result = {
            __typename: "FileDiffView",
            path,
            status: "modified",
            binary: false,
            patch: `@@ -1 +1 @@\n-old\n+${path}`,
            truncated: false,
          };
          return (operation === "WorktreeFileDiff"
            ? { worktree_file_diff: result }
            : { module_file_diff: result }) as never;
        }
        return http.executeGraphQl(document, variables as never);
      },
    });

    const first = screen.getByRole("button", { name: FILE.path });
    const second = screen.getByRole("button", { name: SECOND_FILE.path });
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "false");
    expect(requests).toEqual([]);

    first.focus();
    fireEvent.click(first);
    expect(first).toHaveFocus();
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("Loading diff");
    expect(first).toHaveFocus();
    releaseFirstDiff?.();
    await screen.findByTestId("highlighted-patch");
    expect(first).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Switch checkout" }));
    expect(screen.getByRole("heading", { name: "Module checkout" })).toBeVisible();
    expect(screen.getByRole("button", { name: FILE.path })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Previous changed file" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: SECOND_FILE.path }));
    await waitFor(() => expect(requests).toContainEqual({
      operation: "ModuleFileDiff",
      path: SECOND_FILE.path,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Switch checkout" }));
    expect(screen.getByRole("heading", { name: "Task checkout" })).toBeVisible();
    expect(screen.getByRole("button", { name: FILE.path })).toHaveAttribute("aria-pressed", "true");

    const previous = screen.getByRole("button", { name: "Previous changed file" });
    previous.focus();
    fireEvent.click(previous);
    expect(previous).toHaveFocus();
    expect(screen.getByRole("button", { name: SECOND_FILE.path })).toHaveAttribute("aria-pressed", "true");

    const next = screen.getByRole("button", { name: "Next changed file" });
    next.focus();
    fireEvent.click(next);
    expect(next).toHaveFocus();
    expect(screen.getByRole("button", { name: FILE.path })).toHaveAttribute("aria-pressed", "true");
  });
});
