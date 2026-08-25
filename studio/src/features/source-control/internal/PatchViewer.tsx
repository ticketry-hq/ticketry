import { PatchDiff } from "@pierre/diffs/react";

/**
 * The syntax-highlighted unified diff.
 *
 * A deliberately thin wrapper over `@pierre/diffs` (Apache-2.0, © The Pierre
 * Computer Company): v1 renders one read-only working-tree patch, so none of
 * the library's editing, annotation, or multi-scope surface is wired up. This
 * module is loaded lazily — its Shiki grammars are far larger than the rest of
 * the tab, and a reviewer who never opens a file should never pay for them.
 */
export default function PatchViewer({ patch }: { patch: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="patch-viewer">
      <PatchDiff
        patch={patch}
        options={{
          theme: "tokyo-night",
          themeType: "dark",
          diffStyle: "unified",
          overflow: "scroll",
          disableFileHeader: true,
          // The panel already names the file and its counts above the diff.
          enableLineSelection: false,
        }}
      />
    </div>
  );
}
