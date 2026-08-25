import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../types";
import { buildChangedFileTree } from "./changedFileTree";

const changedFile = (
  path: string,
  overrides: Partial<ChangedFile> = {},
): ChangedFile => ({
  path,
  status: "modified",
  original_path: null,
  binary: false,
  insertions: 1,
  deletions: 1,
  ...overrides,
});

describe("changed file tree", () => {
  it("groups normalized paths while retaining each file's original record", () => {
    const forwardSlashFile = changedFile("src/app/panel.tsx");
    const backslashFile = changedFile("src\\app\\shell.tsx");

    const tree = buildChangedFileTree([forwardSlashFile, backslashFile]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: "folder",
      label: "src/app",
      path: "src/app",
      children: [
        {
          kind: "file",
          name: "panel.tsx",
          normalizedPath: "src/app/panel.tsx",
          file: forwardSlashFile,
        },
        {
          kind: "file",
          name: "shell.tsx",
          normalizedPath: "src/app/shell.tsx",
          file: backslashFile,
        },
      ],
    });
  });

  it("stops compaction at a branch or file and keeps root files visible", () => {
    const tree = buildChangedFileTree([
      changedFile("a/b/one.ts"),
      changedFile("a/b/c/two.ts"),
      changedFile("README.md"),
    ]);

    expect(tree).toMatchObject([
      {
        kind: "folder",
        label: "a/b",
        children: [
          { kind: "folder", label: "c" },
          { kind: "file", name: "one.ts" },
        ],
      },
      { kind: "file", name: "README.md" },
    ]);
  });

  it("sorts folders before files with stable case-insensitive natural ordering", () => {
    const tree = buildChangedFileTree([
      changedFile("alpha/inside.ts"),
      changedFile("Alpha/inside.ts"),
      changedFile("folder10/inside.ts"),
      changedFile("folder2/inside.ts"),
      changedFile("file10.ts"),
      changedFile("file2.ts"),
    ]);

    expect(
      tree.map((node) =>
        node.kind === "folder" ? `folder:${node.label}` : `file:${node.name}`,
      ),
    ).toEqual([
      "folder:alpha",
      "folder:Alpha",
      "folder:folder2",
      "folder:folder10",
      "file:file2.ts",
      "file:file10.ts",
    ]);
  });

  it("adds descendant numeric stats without counting binary or unknown files", () => {
    const tree = buildChangedFileTree([
      changedFile("src/known.ts", { insertions: 3, deletions: 1 }),
      changedFile("src/image.png", {
        binary: true,
        insertions: 50,
        deletions: 50,
      }),
      changedFile("src/unreadable.ts", {
        insertions: null,
        deletions: null,
      }),
      changedFile("assets/logo.png", {
        binary: true,
        insertions: null,
        deletions: null,
      }),
    ]);

    expect(tree).toMatchObject([
      { kind: "folder", label: "assets", stats: null },
      {
        kind: "folder",
        label: "src",
        stats: { insertions: 3, deletions: 1 },
      },
    ]);
  });
});
