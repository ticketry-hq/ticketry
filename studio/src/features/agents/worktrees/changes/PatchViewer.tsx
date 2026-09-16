import { PatchDiff } from "@pierre/diffs/react";

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
          enableLineSelection: false,
        }}
      />
    </div>
  );
}
