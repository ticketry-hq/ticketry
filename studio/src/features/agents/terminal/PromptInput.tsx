import { useRef, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import {
  useModalStore,
  type StandardModalType,
} from "../../../app/modal/modalStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";

export interface PromptInputPayload {
  /** Next modal kind to push after submit, e.g. "agent-picker". */
  next: StandardModalType;
  /** Payload prefix to merge with `{ initialPrompt: text }`. */
  nextPayload?: Record<string, unknown>;
}

export function PromptInput({ payload }: { payload?: PromptInputPayload }) {
  const popModal = useModalStore((s) => s.popModal);
  const pushModal = useModalStore((s) => s.pushModal);
  const [text, setText] = useState("");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  function submit(): void {
    popModal();
    if (payload?.next) {
      pushModal({
        type: payload.next,
        payload: { ...(payload.nextPayload ?? {}), initialPrompt: text },
      });
    }
  }

  return (
    <ModalShell
      title="Prompt"
      bindings={[
        { actionId: MODAL_ACTIONS.submit, label: "Submit" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={(actionId) => {
        if (actionId === MODAL_ACTIONS.submit) submit();
      }}
      initialFocusRef={textAreaRef}
    >
      <textarea
        ref={textAreaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
        placeholder="Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits."
      />
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
          onClick={submit}
          className="border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent"
        >
          Submit
        </button>
      </div>
    </ModalShell>
  );
}
