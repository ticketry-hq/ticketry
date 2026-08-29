interface EmptyModuleWorkspaceProps {
  kind: "no-modules" | "all-hidden";
  sidebarVisible: boolean;
  onCreate: () => void;
}

export function EmptyModuleWorkspace({
  kind,
  sidebarVisible,
  onCreate,
}: EmptyModuleWorkspaceProps) {
  if (kind === "no-modules") {
    return (
      <div
        data-testid="empty-project-workspace"
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-text-muted"
      >
        <p>No modules yet. Add a module to start planning work.</p>
        <button
          type="button"
          onClick={onCreate}
          className="border border-pane-border px-2 py-1 text-text-primary hover:bg-pane-title"
        >
          + Add Module
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="empty-module-workspace"
      className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted"
    >
      {sidebarVisible
        ? "Select a module in the Modules pane to restore its tab."
        : "Open the Modules sidebar to restore a module tab."}
    </div>
  );
}
