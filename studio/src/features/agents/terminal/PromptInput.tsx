import { useRef, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import {
  useModalStore,
  type StandardModalType,
} from "../../../app/modal/modalStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";

export interface PromptInputPayload {
  /** Next modal kind to push after submit, e.g. "agent-picker". */
  next?: StandardModalType;
  /** Payload prefix to merge with `{ initialPrompt: text }`. */
  nextPayload?: Record<string, unknown>;
  /** Direct submit path for flows that do not need another modal. */
  onSubmit?: (text: string) => void | Promise<void>;
  requireText?: boolean;
  submitLabel?: string;
}

export function PromptInput({ payload }: { payload?: PromptInputPayload }) {
  const popModal = useModalStore((s) => s.popModal);
  const pushModal = useModalStore((s) => s.pushModal);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const usableText = text.trim();

  async function submit(): Promise<void> {
    if (busy || (payload?.requireText && !usableText)) return;
    if (payload?.onSubmit) {
      setBusy(true);
      setError(null);
      try {
        await payload.onSubmit(usableText);
        popModal();
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "Could not start the conversation. Retry to continue.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
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
        if (actionId === MODAL_ACTIONS.submit) void submit();
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
      {error ? (
        <div className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={popModal}
          disabled={busy}
          className="border border-pane-border bg-pane-bg px-3 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || Boolean(payload?.requireText && !usableText)}
          className="border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent"
        >
          {busy ? "Starting…" : payload?.submitLabel ?? "Submit"}
        </button>
      </div>
    </ModalShell>
  );
}
