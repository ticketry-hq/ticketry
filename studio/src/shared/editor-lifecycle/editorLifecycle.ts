import { useState } from "react";
import { useEditorDraft } from "./editorDraft";
import { useSaveSequencer } from "./saveSequencer";

/**
 * Persists a draft (or a save input derived from it) and resolves with the
 * authoritative saved value. The binding owns transport and cache effects.
 * Resolving `undefined` means the sent value is what was stored; resolving
 * `null` means the write was not applied, so nothing is marked saved.
 */
export type SaveBinding<Draft, Input = Draft> = (
  input: Input,
) => Promise<Draft | null | undefined | void>;

export type SaveOutcome =
  | { kind: "none" }
  | { kind: "saved" }
  | { kind: "failed"; error: unknown };

/** States only; each surface supplies its own wording and tone. */
export interface EditorStatus {
  loading: boolean;
  loadError: unknown;
  saving: boolean;
  dirty: boolean;
  /** The first field or record validation message for the draft. */
  validation: string | null;
  outcome: SaveOutcome;
}

export interface EditorLifecycleOptions<Draft, Input = Draft> {
  /** Names the record being edited; a change resets the draft. */
  identity: string;
  /** The saved value from the caller's Apollo read; `undefined` until hydrated. */
  authoritative: Draft | undefined;
  /** Shown while the identity is not hydrated. */
  empty: Draft;
  equals: (left: Draft, right: Draft) => boolean;
  save: SaveBinding<Draft, Input>;
  validate?: (draft: Draft) => string | null;
  /** The draft an autosave input stands for; required when Input is not Draft. */
  draftOf?: (input: Input) => Draft;
  /** The save input for a committed draft; required when Input is not Draft. */
  inputOf?: (draft: Draft) => Input;
  loading?: boolean;
  loadError?: unknown;
}

export interface EditorLifecycle<Draft, Input = Draft> {
  draft: Draft;
  status: EditorStatus;
  edit: (next: Draft) => void;
  discard: () => void;
  /**
   * Explicit commit: validates, then saves the current draft. Ignored while a
   * save for this identity runs. Resolves when it settles; failure is reported
   * through `status.outcome`, never by rejecting.
   */
  commit: () => Promise<void>;
  /**
   * Autosave: queues `input` behind any running save for this identity,
   * keeping only the newest. Resolves after the queue drains; the first error
   * is reported through `status.outcome`.
   */
  autosave: (input: Input) => Promise<void>;
}

const NO_OUTCOME: SaveOutcome = { kind: "none" };

export function useEditorLifecycle<Draft, Input = Draft>(
  options: EditorLifecycleOptions<Draft, Input>,
): EditorLifecycle<Draft, Input> {
  const { identity } = options;
  const draft = useEditorDraft(identity, options.authoritative, options.empty, options.equals);
  const sequencer = useSaveSequencer(identity);
  const [outcome, setOutcome] = useState({ identity, outcome: NO_OUTCOME });
  const validation = options.validate?.(draft.draft) ?? null;

  // A completion for an identity that is no longer edited sets no status.
  const report = (scope: string, next: SaveOutcome): void => {
    if (sequencer.isCurrent(scope)) setOutcome({ identity: scope, outcome: next });
  };
  const sendRun = (scope: string, input: Input, sent: Draft) => async () => {
    const saved = await options.save(input);
    if (saved === null) return false;
    draft.markSaved(scope, sent, saved ?? sent);
    return true;
  };
  const settle = (scope: string, run: Promise<boolean>): Promise<void> =>
    run.then(
      (applied) => {
        if (applied) report(scope, { kind: "saved" });
      },
      (error: unknown) => report(scope, { kind: "failed", error }),
    );

  const commit = async (): Promise<void> => {
    const sent = draft.draft;
    if (options.validate?.(sent)) return;
    const input = options.inputOf ? options.inputOf(sent) : (sent as unknown as Input);
    const run = sequencer.runExclusive(identity, sendRun(identity, input, sent));
    if (!run) return;
    report(identity, NO_OUTCOME);
    await settle(identity, run);
  };
  const autosave = (input: Input): Promise<void> => {
    const sent = options.draftOf ? options.draftOf(input) : (input as unknown as Draft);
    return settle(identity, sequencer.enqueueLatest(identity, sendRun(identity, input, sent)));
  };

  return {
    draft: draft.draft,
    status: {
      loading: options.loading ?? false,
      loadError: options.loadError,
      saving: sequencer.saving,
      dirty: draft.dirty,
      validation,
      outcome: outcome.identity === identity ? outcome.outcome : NO_OUTCOME,
    },
    edit: (next) => {
      draft.edit(next);
      setOutcome({ identity, outcome: NO_OUTCOME });
    },
    discard: () => {
      draft.discard();
      setOutcome({ identity, outcome: NO_OUTCOME });
    },
    commit,
    autosave,
  };
}
