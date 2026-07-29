import { useEffect } from "react";
import { useTasksStore } from "../studio/stores/tasksStore";
import { IssueTypesSection } from "./IssueTypesSection";
import { StateCatalog } from "./StateCatalog";
import { useWorkflowEditorStore } from "./workflowEditorStore";

export function WorkflowSettingsPanel({
  activeSection,
}: {
  activeSection: "states" | "issue-types";
}) {
  const projectId = useTasksStore((state) => state.selectedProjectId);
  const loading = useWorkflowEditorStore((state) => state.loading);
  const action = useWorkflowEditorStore((state) => state.action);
  const load = useWorkflowEditorStore((state) => state.load);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  if (!projectId) {
    return <p className="text-sm text-text-muted">Select a project to configure its workflow.</p>;
  }

  return (
    <section aria-label="Workflow settings" className="min-w-0 space-y-4">
      {loading || action?.startsWith("load:")
        ? <span className="text-sm text-text-muted">Loading workflow…</span>
        : null}

      {activeSection === "issue-types" ? <IssueTypesSection /> : (
        <section aria-label="State catalog" className="min-h-64">
          <StateCatalog />
        </section>
      )}
    </section>
  );
}
