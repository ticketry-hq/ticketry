import { useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { useTasksStore } from "../stores/tasksStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";

export function StatusUpdate() {
  const allStates = useTasksStore((s) => s.states);
  // Only real, settable Plane states (the synthetic scratch state has no id).
  const states = allStates.filter((st) => st.id !== null);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const popModal = useModalStore((s) => s.popModal);

  const [selectedStateId, setSelectedStateId] = useState(
    () => states[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const selectedIndex = Math.max(
    0,
    states.findIndex((state) => state.id === selectedStateId),
  );

  async function commit(stateId: string | null = selectedStateId): Promise<void> {
    const current = useTasksStore.getState();
    const target = current.states.find((state) => state.id === stateId);
    if (!target || !target.id) return;
    if (
      current.selectedProjectId !== selectedProjectId ||
      current.selectedTaskId !== selectedTaskId ||
      !selectedProjectId ||
      !selectedTaskId
    ) {
      return;
    }
    setBusy(true);
    try {
      await current.updateTaskStatus(selectedProjectId, selectedTaskId, target.id);
      popModal();
    } finally {
      setBusy(false);
    }
  }

  function onAction(actionId: string) {
    if (actionId === MODAL_ACTIONS.next) {
      const next = states[Math.min(states.length - 1, selectedIndex + 1)];
      setSelectedStateId(next?.id ?? null);
    } else if (actionId === MODAL_ACTIONS.previous) {
      const previous = states[Math.max(0, selectedIndex - 1)];
      setSelectedStateId(previous?.id ?? null);
    } else if (actionId === MODAL_ACTIONS.confirm) {
      void commit();
    }
  }

  return (
    <ModalShell
      title="Set Status"
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
      {states.length === 0 ? (
        <div className="text-text-muted">No states available</div>
      ) : (
        <ul>
          {states.map((s, i) => (
            <li
              key={s.id ?? s.name}
              onClick={() => {
                setSelectedStateId(s.id);
                void commit(s.id);
              }}
              className={`cursor-pointer rounded px-2 py-1 ${
                i === selectedIndex
                  ? "bg-selection-bg text-text-primary"
                  : "hover:bg-pane-title"
              }`}
            >
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {busy && <div className="mt-2 text-text-muted">Saving…</div>}
    </ModalShell>
  );
}
