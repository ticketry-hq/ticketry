interface EmptyModuleWorkspaceProps {
  kind: "no-modules" | "all-hidden";
  onManage: () => void;
  onCreate: () => void;
}

export function EmptyModuleWorkspace({
  kind,
  onManage,
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
          New module
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="empty-module-workspace"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-text-muted"
    >
      <p>All module tabs are hidden. Restore a tab in the Module Manager.</p>
      <button type="button" onClick={onManage}
        className="border border-pane-border px-2 py-1 text-text-primary hover:bg-pane-title focus-visible:outline focus-visible:outline-focus-accent">
        Manage modules
      </button>
    </div>
  );
}
