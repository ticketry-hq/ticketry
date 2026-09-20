import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChangesFileReview } from "../features/agents/worktrees/changes/ChangesFileReview";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio } from "./seam";

vi.mock("../features/agents/worktrees/changes/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => (
    <div data-testid="patch-viewer">{patch}</div>
  ),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const checkoutFiles = {
  "checkout-a": [
    { path: "src/a-first.ts", status: "modified" },
    { path: "src/a-second.ts", status: "modified" },
  ],
  "checkout-b": [{ path: "src/b-current.ts", status: "modified" }],
} as const;

function ReviewHarness() {
  const [checkout, setCheckout] = useState<keyof typeof checkoutFiles>(
    "checkout-a",
  );
  return (
    <>
      <button type="button" onClick={() => setCheckout("checkout-b")}>
        Switch to checkout B
      </button>
      <ChangesFileReview
        checkoutKey={`task:${checkout}`}
        checkouts={<p>{checkout}</p>}
        header={<h2>{checkout} changes</h2>}
        taskId={checkout}
        files={checkoutFiles[checkout]}
        insertions={1}
        deletions={1}
        truncated={false}
        label={`${checkout} changed files`}
        emptyMessage="No changes."
      />
    </>
  );
}

function fileDiff(path: string, patch: string) {
  return {
    worktree_file_diff: {
      __typename: "FileDiffView",
      path,
      status: "modified",
      binary: false,
      patch,
      truncated: false,
    },
  };
}

describe("overhaul acceptance - Changes workspace stale data", () => {
  it("never presents a late file diff from another selection or checkout", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    const responses = new Map<string, Deferred<ReturnType<typeof fileDiff>>>();

    mountStudio({
      http,
      children: <ReviewHarness />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "WorktreeFileDiff") {
          const { taskId, path } = variables as { taskId: string; path: string };
          const key = `${taskId}:${path}`;
          const response = deferred<ReturnType<typeof fileDiff>>();
          responses.set(key, response);
          return await response.promise as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const firstFiles = await screen.findByRole("list", {
      name: "checkout-a changed files",
    });
    fireEvent.click(within(firstFiles).getByRole("button", { name: "src/a-first.ts" }));
    await waitFor(() =>
      expect(responses.has("checkout-a:src/a-first.ts")).toBe(true),
    );
    fireEvent.click(within(firstFiles).getByRole("button", { name: "src/a-second.ts" }));
    await waitFor(() =>
      expect(responses.has("checkout-a:src/a-second.ts")).toBe(true),
    );

    act(() => {
      responses.get("checkout-a:src/a-second.ts")?.resolve(
        fileDiff("src/a-second.ts", "+second checkout A diff"),
      );
    });
    expect(await screen.findByTestId("patch-viewer")).toHaveTextContent(
      "+second checkout A diff",
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to checkout B" }));
    const secondFiles = await screen.findByRole("list", {
      name: "checkout-b changed files",
    });
    const diffRegion = screen.getByRole("region", { name: "Selected file diff" });
    expect(within(diffRegion).getByText("Select a file to review its diff.")).toBeVisible();
    expect(within(diffRegion).queryByText("+second checkout A diff")).toBeNull();

    fireEvent.click(within(secondFiles).getByRole("button", { name: "src/b-current.ts" }));
    await waitFor(() =>
      expect(responses.has("checkout-b:src/b-current.ts")).toBe(true),
    );
    act(() => {
      responses.get("checkout-b:src/b-current.ts")?.resolve(
        fileDiff("src/b-current.ts", "+current checkout B diff"),
      );
    });
    expect(await screen.findByTestId("patch-viewer")).toHaveTextContent(
      "+current checkout B diff",
    );

    act(() => {
      responses.get("checkout-a:src/a-first.ts")?.resolve(
        fileDiff("src/a-first.ts", "+late checkout A diff"),
      );
    });
    await waitFor(() =>
      expect(within(diffRegion).getByTestId("patch-viewer")).toHaveTextContent(
        "+current checkout B diff",
      ),
    );
    expect(within(diffRegion).queryByText("+late checkout A diff")).toBeNull();
    expect(within(diffRegion).getByText("src/b-current.ts")).toBeVisible();
  });
});
