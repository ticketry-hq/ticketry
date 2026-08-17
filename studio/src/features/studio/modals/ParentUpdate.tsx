import { useMemo, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { useModulesQuery } from "../../projects";
import { useStudioStore } from "../../projects/store";
import { useClientStore } from "../../../state/clientStore";
import { useModuleTree } from "../../work-items/queries";
import {
  useSetWorkItemParent,
  useWorkItem,
  useWorkItemsByIds,
} from "../../work-items";
import { apiErrorMessage } from "../../../shared/api/client";
import { toast } from "../../../state/clientStore";
import { TEMP_TASK_ID } from "../../agents/types";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";

interface Candidate {
  id: string;
  label: string;
}

export interface ParentUpdatePayload {
  // "epic" reparents under a module; "parent" reparents under another task.
  // Both write the single `parent_id` field — only the candidate list differs.
  mode: "epic" | "parent";
}

/**
 * Reparent the selected work item. In "epic" mode the candidates are the
 * project's modules; in "parent" mode they are the other tasks/sub-tasks
 * loaded for the current module. Candidate labels and the selected record come
 * from their per-item holdings.
 */
export function ParentUpdate({ payload }: { payload?: ParentUpdatePayload }) {
  const mode = payload?.mode ?? "parent";
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const membership = useModuleTree(selectedProjectId, selectedModuleId);
  const tasks = useWorkItemsByIds(membership.order);
  const modules = useModulesQuery(selectedProjectId).data ?? [];
  const { data: selectedTask } = useWorkItem(
    selectedTaskId && selectedTaskId !== TEMP_TASK_ID ? selectedTaskId : null,
  );
  const setParent = useSetWorkItemParent(
    selectedProjectId && selectedModuleId
      ? [{ projectId: selectedProjectId, moduleId: selectedModuleId }]
      : [],
  );
  const popModal = useModalStore((s) => s.popModal);

  const currentParentId = selectedTask?.parent_id ?? null;

  const candidates = useMemo<Candidate[]>(() => {
    if (mode === "epic") {
      return modules.map((m) => ({ id: m.id, label: m.name }));
    }
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (const t of tasks) {
      if (t.id === TEMP_TASK_ID) continue;
      if (t.id === selectedTaskId) continue; // can't be its own parent
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, label: t.name });
    }
    return out;
  }, [mode, tasks, modules, selectedTaskId]);

  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.label.toLowerCase().includes(q));
  }, [candidates, filter]);

  async function commit(target?: Candidate): Promise<void> {
    const chosen = target ?? visible[cursor];
    if (!chosen) return;
    if (!selectedProjectId || !selectedTaskId) return;
    if (chosen.id === currentParentId) {
      popModal();
      return;
    }
    setBusy(true);
    try {
      await setParent.mutateAsync({ id: selectedTaskId, parentId: chosen.id });
      popModal();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function onAction(actionId: string) {
    if (actionId === MODAL_ACTIONS.next) {
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    } else if (actionId === MODAL_ACTIONS.previous) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (actionId === MODAL_ACTIONS.confirm) {
      void commit();
    }
  }

  return (
    <ModalShell
      title={mode === "epic" ? "Set Module" : "Set Parent"}
      bindings={[
        {
          actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next],
          label: "Move",
        },
        { actionId: MODAL_ACTIONS.confirm, label: "Set" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={onAction}
    >
      <input
        type="text"
        value={filter}
        placeholder={mode === "epic" ? "Filter modules…" : "Filter tasks…"}
        onChange={(e) => {
          setFilter(e.target.value);
          setCursor(0);
        }}
        className="mb-2 w-full border border-pane-border bg-pane-bg px-2 py-1 text-text-primary outline-none focus:border-focus-accent"
      />
      {visible.length === 0 ? (
        <div className="text-text-muted">
          {mode === "epic" ? "No modules available" : "No candidate parents"}
        </div>
      ) : (
        <ul>
          {visible.map((c, i) => (
            <li
              key={c.id}
              onClick={() => {
                setCursor(i);
                void commit(c);
              }}
              className={`flex cursor-pointer items-center justify-between px-2 py-1 ${
                i === cursor
                  ? "bg-selection-bg text-text-primary"
                  : "hover:bg-pane-title"
              }`}
            >
              <span>{c.label}</span>
              {c.id === currentParentId && (
                <span className="text-xs text-text-muted">current</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy && <div className="mt-2 text-text-muted">Saving…</div>}
    </ModalShell>
  );
}
