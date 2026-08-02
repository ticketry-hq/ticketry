import { useEffect, useState } from "react";
import * as api from "../../../shared/api/client";
import { type IssueType, type WorkItem } from "../../../shared/api/types";
import { stateColor } from "../../../shared/utilities/display";
import { useTasksStore } from "../../studio/stores/tasksStore";

interface ChildIssuesProps {
  children: WorkItem[];
  projectId: string;
  onAddSubtask: (name: string, issueTypeId: string) => void;
}

export default function ChildIssues({
  children,
  projectId,
  onAddSubtask,
}: ChildIssuesProps) {
  const selectTask = useTasksStore((state) => state.selectTask);
  const [newSub, setNewSub] = useState("");
  const [issueTypes, setIssueTypes] = useState<IssueType[]>([]);
  const [issueTypeId, setIssueTypeId] = useState("");

  useEffect(() => {
    let active = true;
    setIssueTypes([]);
    setIssueTypeId("");
    void api.listIssueTypes(projectId).then((types) => {
      if (active) setIssueTypes(types.filter((type) => type.level === "task"));
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-text-secondary">
          Child issues
        </span>
        <span className="text-xs text-text-muted">{children.length}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-pane-border" data-testid="child-issues">
        {children.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-muted">No sub-tasks yet.</div>
        ) : (
          children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void selectTask(c.id)}
              className="flex w-full items-center gap-2.5 border-b border-pane-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-pane-title"
            >
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ backgroundColor: stateColor(c.state) }}
              />
              <span className="w-20 flex-none font-mono text-xs text-text-muted">{c.key}</span>
              <span className="flex-1 truncate text-base text-text-primary">{c.name}</span>
            </button>
          ))
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <select
            value={issueTypeId}
            onChange={(event) => setIssueTypeId(event.target.value)}
            aria-label="Child issue type"
            data-testid="add-subtask-type"
            className="rounded border border-pane-border bg-pane-bg px-2 py-1 text-sm text-text-primary outline-none focus:border-focus-accent"
          >
            <option value="">Select type…</option>
            {issueTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>
          <input
            value={newSub}
            onChange={(e) => setNewSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSub.trim() && issueTypeId) {
                void onAddSubtask(newSub, issueTypeId);
                setNewSub("");
              }
            }}
            placeholder="Add sub-task…"
            data-testid="add-subtask"
            className="min-w-0 flex-1 rounded border border-pane-border bg-pane-bg px-2 py-1 text-sm text-text-primary outline-none focus:border-focus-accent"
          />
        </div>
      </div>
    </div>
  );
}
