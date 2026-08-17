import { useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { useStudioStore } from "../../projects/store";
import { useClientStore } from "../../../state/clientStore";
import { useCachedStates } from "../../../shared/query/stateCatalog";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { useSetWorkItemState } from "../../work-items";
import { apiErrorMessage, isNoOpTransition } from "../../../shared/api/client";
import { toast } from "../../../state/clientStore";

export function StatusUpdate() {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const allStates = useCachedStates(selectedProjectId);
  // Only real, settable Plane states (the synthetic scratch state has no id).
  const states = allStates.filter((st) => st.id !== null);
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const setState = useSetWorkItemState();
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
    const currentProjectId = useStudioStore.getState().selectedProjectId;
    const currentTaskId = useClientStore.getState().selectedTaskId;
    const target = states.find((state) => state.id === stateId);
    if (!target || !target.id) return;
    if (
      currentProjectId !== selectedProjectId ||
      currentTaskId !== selectedTaskId ||
      !selectedProjectId ||
      !selectedTaskId
    ) {
      return;
    }
    setBusy(true);
    try {
      await setState.mutateAsync({
        id: selectedTaskId,
        state: target as typeof target & { id: string },
      });
      popModal();
    } catch (error) {
      if (!isNoOpTransition(error)) toast.error(apiErrorMessage(error));
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
              className={`cursor-pointer px-2 py-1 ${
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
