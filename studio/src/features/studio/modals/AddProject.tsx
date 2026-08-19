import { useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { apiErrorMessage } from "../../../shared/api/client";
import { createProjectRecord } from "../../projects";

export function AddProject() {
  const popModal = useModalStore((state) => state.popModal);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    name.trim().length > 0 && key.trim().length > 0 && !busy;

  async function submit(): Promise<void> {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      await createProjectRecord({
        name: name.trim(),
        slug: key.trim(),
      });
      popModal();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Add Project"
      bindings={[
        { actionId: MODAL_ACTIONS.confirm, label: "Create" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={(actionId) => {
        if (actionId === MODAL_ACTIONS.confirm) void submit();
      }}
      width="w-[60ch]"
    >
      <label className="block text-sm text-text-muted">
        Name
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name"
          spellCheck={false}
          className="mt-1 w-full bg-pane-bg px-2 py-1 font-mono text-sm text-text-primary outline-none ring-1 ring-pane-border focus:ring-focus-accent"
        />
      </label>
      <label className="mt-3 block text-sm text-text-muted">
        Key
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          maxLength={3}
          placeholder="Project key"
          spellCheck={false}
          className="mt-1 w-full bg-pane-bg px-2 py-1 font-mono text-sm uppercase text-text-primary outline-none ring-1 ring-pane-border focus:ring-focus-accent"
        />
        <span className="mt-1 block text-xs text-text-muted">
          Project key must be exactly three letters, using only A-Z.
        </span>
      </label>
      {error && (
        <div className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={popModal}
          className="border border-pane-border bg-pane-bg px-3 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
}
