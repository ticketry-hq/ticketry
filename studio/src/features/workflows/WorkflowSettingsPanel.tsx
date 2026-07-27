import { useEffect, useState } from "react";
import { useTasksStore } from "../studio/stores/tasksStore";
import { IssueTypesSection } from "./IssueTypesSection";
import { StateCatalog } from "./StateCatalog";
import { useWorkflowEditorStore } from "./workflowEditorStore";

const PANEL_CLASS = "rounded border border-pane-border bg-pane-bg p-3";

export function WorkflowSettingsPanel() {
  const projectId = useTasksStore((state) => state.selectedProjectId);
  const loading = useWorkflowEditorStore((state) => state.loading);
  const action = useWorkflowEditorStore((state) => state.action);
  const notice = useWorkflowEditorStore((state) => state.notice);
  const error = useWorkflowEditorStore((state) => state.error);
  const load = useWorkflowEditorStore((state) => state.load);
  const [activeSection, setActiveSection] = useState<"states" | "issue-types">("states");

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  if (!projectId) {
    return <p className="text-sm text-text-muted">Select a project to configure its workflow.</p>;
  }

  return (
    <section aria-label="Workflow settings" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Workflow settings sections" className="inline-flex rounded-md border border-pane-border bg-pane-bg p-0.5">
          {(["states", "issue-types"] as const).map((section) => (
            <button
              key={section}
              type="button"
              role="tab"
              aria-selected={activeSection === section}
              onClick={() => setActiveSection(section)}
              className={activeSection === section
                ? "rounded bg-pane-title px-3 py-1.5 text-sm font-medium text-text-primary"
                : "rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"}
            >
              {section === "states" ? "States" : "Issue Types"}
            </button>
          ))}
        </div>
        {loading || action?.startsWith("load:")
          ? <span className="text-sm text-text-muted">Loading workflow…</span>
          : null}
      </div>

      {notice ? <div role="status" className="text-sm text-emerald-300">{notice}</div> : null}
      {error ? (
        <div role="alert" className="rounded border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {activeSection === "issue-types" ? <IssueTypesSection /> : (
        <section aria-label="State catalog" className={`${PANEL_CLASS} min-h-64`}>
          <h3 className="text-base font-semibold text-text-primary">States</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Project-wide names, groups, colors, and display order.
          </p>
          <StateCatalog />
        </section>
      )}
    </section>
  );
}
