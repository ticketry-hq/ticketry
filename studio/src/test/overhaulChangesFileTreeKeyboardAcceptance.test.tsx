import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { ChangedFilesList } from "../features/agents/worktrees/changes/ChangedFilesList";
import { fixture, mountStudio } from "./seam";

const files = [
  { path: "src/a.ts", status: "modified" },
  { path: "src/nested/b.ts", status: "added" },
  { path: "README.md", status: "deleted" },
];

describe("overhaul acceptance - Changes file-tree keyboard review", () => {
  it("[overhaul-348] traverses visible rows and activates files without selection following focus", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onSelect = vi.fn();
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({
      http,
      children: (
        <>
          <ChangedFilesList
            checkoutKey="module:one"
            files={files}
            label="Module changed files"
            descriptionPrefix="module-one"
            selectedPath={null}
            onSelect={onSelect}
          />
          <button type="button">After files</button>
        </>
      ),
    });
    const keymap = renderHook(() => useGlobalKeymap());
    const list = screen.getByRole("list", { name: "Module changed files" });
    const src = within(list).getByRole("button", { name: "src" });
    const nested = within(list).getByRole("button", { name: "src/nested" });
    const a = within(list).getByRole("button", { name: "src/a.ts" });
    const readme = within(list).getByRole("button", { name: "README.md" });

    // Tree order: directories before files at each level, so src, src/nested,
    // src/nested/b.ts, src/a.ts, then the root file README.md.
    src.focus();
    fireEvent.keyDown(src, { key: "ArrowDown" });
    expect(nested).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(nested, { key: "ArrowLeft" });
    expect(nested).toHaveFocus();
    expect(within(list).queryByRole("button", { name: "src/nested/b.ts" })).toBeNull();
    fireEvent.keyDown(nested, { key: "ArrowRight" });
    expect(within(list).getByRole("button", { name: "src/nested/b.ts" })).toBeVisible();
    fireEvent.keyDown(nested, { key: " " });
    expect(within(list).queryByRole("button", { name: "src/nested/b.ts" })).toBeNull();
    fireEvent.keyDown(nested, { key: "ArrowDown" });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a, { key: "ArrowDown" });
    expect(readme).toHaveFocus();
    fireEvent.keyDown(readme, { key: "ArrowDown" });
    expect(readme).toHaveFocus();
    fireEvent.keyDown(readme, { key: "Home" });
    expect(src).toHaveFocus();
    fireEvent.keyDown(src, { key: "End" });
    expect(readme).toHaveFocus();
    fireEvent.keyDown(readme, { key: "ArrowRight" });
    expect(readme).toHaveFocus();

    fireEvent.keyDown(readme, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("README.md");
    expect(readme).toHaveFocus();
    fireEvent.keyDown(readme, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    keymap.unmount();
  });

  it("[overhaul-349] recovers file focus by path across refresh, removal, collapse, and empty fallback", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let replaceFiles: (next: typeof files) => void = () => undefined;
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });

    function Harness() {
      const [rows, setRows] = useState(files);
      replaceFiles = setRows;
      return (
        <>
          <ChangedFilesList
            checkoutKey="task:one"
            files={rows}
            label="Cumulative changed files"
            descriptionPrefix="task-one"
            selectedPath={null}
          />
          <button type="button">After changed files</button>
        </>
      );
    }

    mountStudio({ http, children: <Harness /> });
    const keymap = renderHook(() => useGlobalKeymap());
    const b = screen.getByRole("button", { name: "src/nested/b.ts" });
    b.focus();

    act(() => replaceFiles([files[2], files[1], files[0]]));
    expect(screen.getByRole("button", { name: "src/nested/b.ts" })).toHaveFocus();

    // b.ts sat at index 2 (src, src/nested, b.ts); removing it leaves README.md there.
    act(() => replaceFiles([files[2], files[0]]));
    await waitFor(() => expect(screen.getByRole("button", { name: "README.md" })).toHaveFocus());

    const a = screen.getByRole("button", { name: "src/a.ts" });
    a.focus();
    const src = screen.getByRole("button", { name: "src" });
    fireEvent.click(src);
    expect(src).toHaveFocus();
    expect(screen.queryByRole("button", { name: "src/a.ts" })).toBeNull();

    const departure = screen.getByRole("button", { name: "After changed files" });
    departure.focus();
    act(() => replaceFiles([files[0], files[2]]));
    expect(departure).toHaveFocus();

    screen.getByRole("button", { name: "src" }).focus();

    act(() => replaceFiles([]));
    await waitFor(() => expect(screen.getByRole("region", {
      name: "Cumulative changed files empty",
    })).toHaveFocus());
    keymap.unmount();
  });
});
