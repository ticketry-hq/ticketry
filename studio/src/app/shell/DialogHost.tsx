import { useEffect, useRef, useState } from "react";
import { ModalShell } from "../modal/ModalShell";
import {
  useClientStore,
  type DialogDescriptor,
} from "../../state/clientStore";

const buttonClass =
  "border border-pane-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-pane-title disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass = `${buttonClass} bg-accent-primary text-white hover:bg-accent-primary/80`;
const dangerButtonClass = `${buttonClass} border-lifecycle-danger/60 bg-lifecycle-danger/15 text-lifecycle-danger hover:bg-lifecycle-danger/25`;

function ConfirmDialog({
  descriptor,
}: {
  descriptor: Extract<DialogDescriptor, { kind: "confirm" }>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { opts, resolve } = descriptor;

  return (
    <ModalShell
      title={opts.title}
      ariaLabel={opts.title}
      width="w-[min(32rem,calc(100vw-2rem))]"
      initialFocusRef={cancelRef}
      onClose={() => resolve(false)}
    >
      <p className="whitespace-pre-wrap text-sm text-text-primary">
        {opts.body}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          className={buttonClass}
          onClick={() => resolve(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className={opts.danger ? dangerButtonClass : primaryButtonClass}
          onClick={() => resolve(true)}
        >
          {opts.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmTypedDialog({
  descriptor,
}: {
  descriptor: Extract<DialogDescriptor, { kind: "confirmTyped" }>;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { opts, resolve } = descriptor;

  useEffect(() => setValue(""), [descriptor]);

  return (
    <ModalShell
      title={opts.title}
      ariaLabel={opts.title}
      width="w-[min(32rem,calc(100vw-2rem))]"
      initialFocusRef={inputRef}
      onClose={() => resolve(false)}
    >
      <p className="whitespace-pre-wrap text-sm text-text-primary">
        {opts.body}
      </p>
      <label className="mt-4 block text-xs font-medium text-text-muted">
        Type <span className="font-mono text-text-primary">{opts.confirmText}</span> to confirm
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-2 block w-full border border-pane-border bg-pane-bg px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent-primary"
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => resolve(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={value !== opts.confirmText}
          className={opts.danger ? dangerButtonClass : primaryButtonClass}
          onClick={() => resolve(true)}
        >
          {opts.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </ModalShell>
  );
}

function ReassignDialog({
  descriptor,
}: {
  descriptor: Extract<DialogDescriptor, { kind: "reassign" }>;
}) {
  const { opts, resolve } = descriptor;
  const [selectedId, setSelectedId] = useState(opts.candidates[0]?.id ?? "");
  const selectRef = useRef<HTMLSelectElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelectedId(opts.candidates[0]?.id ?? "");
  }, [descriptor, opts.candidates]);

  const hasCandidates = opts.candidates.length > 0;
  return (
    <ModalShell
      title={opts.title}
      ariaLabel={opts.title}
      width="w-[min(32rem,calc(100vw-2rem))]"
      initialFocusRef={hasCandidates ? selectRef : cancelRef}
      onClose={() => resolve(null)}
    >
      <p className="text-sm text-text-primary">
        {hasCandidates
          ? `Choose where to reassign ${opts.itemName}.`
          : `${opts.itemName} has no assignments to move.`}
      </p>
      {hasCandidates ? (
        <label className="mt-4 block text-xs font-medium text-text-muted">
          Reassign to
          <select
            ref={selectRef}
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="mt-2 block w-full border border-pane-border bg-pane-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-primary"
          >
            {opts.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          className={buttonClass}
          onClick={() => resolve(null)}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={hasCandidates && !selectedId}
          className={primaryButtonClass}
          onClick={() => resolve(hasCandidates ? { reassignTo: selectedId } : {})}
        >
          {hasCandidates ? "Reassign" : "Continue"}
        </button>
      </div>
    </ModalShell>
  );
}

/** Renders the top descriptor from the promise-based confirmation bus. */
export function DialogHost() {
  const top = useClientStore((state) => state.dialogs.at(-1));
  if (!top) return null;

  switch (top.kind) {
    case "confirm":
      return <ConfirmDialog descriptor={top} />;
    case "confirmTyped":
      return <ConfirmTypedDialog descriptor={top} />;
    case "reassign":
      return <ReassignDialog descriptor={top} />;
  }
}
