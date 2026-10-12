import { useState } from "react";
import { useEditorDraft, type DraftUpdate } from "./draftTracking";
import {
  useAutosaveQueue,
  useExplicitCommit,
  type SaveBinding,
  type SaveCallbacks,
} from "./saveSequencing";

export type SaveMode = "commit" | "autosave";

export type SaveOutcome =
  | { kind: "none" }
  | { kind: "saved" }
  | { kind: "failed"; error: unknown };

/** States, not wording: each surface keeps its own feedback text and tone. */
export interface EditorStatus {
  loading: boolean;
  loadError: unknown;
  saving: boolean;
  dirty: boolean;
  /** The first field or record validation message. */
  validation: string | null;
  outcome: SaveOutcome;
  /** Save is possible: hydrated, idle, dirty and valid. */
  canSave: boolean;
  /** Discard is possible: hydrated, idle and dirty. */
  canDiscard: boolean;
}

export interface EditorLifecycleOptions<Draft, Input = Draft> {
  /** The record being edited; a change resets the draft. */
  identity: string;
  /** The caller's Apollo read; `undefined` while not hydrated. */
  authoritative: Draft | undefined;
  equals: (a: Draft, b: Draft) => boolean;
  /** The draft shown before the authoritative value arrives. */
  empty: Draft;
  loading?: boolean;
  loadError?: unknown;
  validate?: (draft: Draft) => string | null;
  mode: SaveMode;
  /** Sends the draft (commit) or a save input (autosave). */
  save: SaveBinding<Input, Draft | unknown>;
  /**
   * Maps a sent save input back to the draft it represents, so marking it
   * saved can compare drafts. Defaults to the input itself.
   */
  savedDraft?: (input: Input) => Draft;
}

export interface EditorLifecycle<Draft, Input = Draft> {
  draft: Draft;
  edit: (next: DraftUpdate<Draft>) => void;
  discard: () => void;
  /**
   * Commit mode validates, then sends the current draft. Autosave mode queues
   * `input` (or the current draft). Never rejects: failures land in `status`.
   */
  save: (input?: Input) => Promise<void>;
  status: EditorStatus;
}

interface ScopedOutcome {
  identity: string;
  outcome: SaveOutcome;
}

const NO_OUTCOME: SaveOutcome = { kind: "none" };

/**
 * The shared edit lifecycle over one authoritative value: draft tracking, save
 * sequencing in explicit-commit or autosave mode, identity-scoped completion,
 * and one status model. The module never fetches; loading and load failure come
 * from the caller's Apollo read state.
 */
export function useEditorLifecycle<Draft, Input = Draft>(
  options: EditorLifecycleOptions<Draft, Input>,
): EditorLifecycle<Draft, Input> {
  const {
    authoritative,
    empty,
    equals,
    identity,
    loading = false,
    loadError,
    mode,
  } = options;
  const toDraft = options.savedDraft ?? ((input: Input) => input as unknown as Draft);
  const editor = useEditorDraft(identity, authoritative, equals, empty);
  const [last, setLast] = useState<ScopedOutcome | null>(null);

  const callbacks: SaveCallbacks<Input, unknown> = {
    onSaved: (scope, input, result) => {
      const sent = toDraft(input);
      editor.markSaved(scope, sent, mode === "commit" ? result as Draft : undefined);
    },
    onSettled: (scope, error, landed) => {
      if (error !== undefined) {
        setLast({ identity: scope, outcome: { kind: "failed", error } });
      } else if (landed) {
        setLast({ identity: scope, outcome: { kind: "saved" } });
      }
    },
  };
  const [commit, committing] = useExplicitCommit(identity, options.save, callbacks);
  const [enqueue, applying] = useAutosaveQueue(identity, options.save, callbacks);

  const validation = options.validate?.(editor.draft) ?? null;
  const saving = committing || applying;
  const idle = editor.hydrated && !loading && !saving;
  const status: EditorStatus = {
    loading,
    loadError,
    saving,
    dirty: editor.dirty,
    validation,
    outcome: last?.identity === identity ? last.outcome : NO_OUTCOME,
    canSave: idle && editor.dirty && validation === null,
    canDiscard: idle && editor.dirty,
  };

  return {
    draft: editor.draft,
    edit: (next) => {
      setLast(null);
      editor.edit(next);
    },
    discard: () => {
      setLast(null);
      editor.discard();
    },
    save: async (input) => {
      if (mode === "autosave") {
        await enqueue(input ?? (editor.draft as unknown as Input)).catch(() => {});
        return;
      }
      if (!status.canSave) return;
      await commit(editor.draft as unknown as Input);
    },
    status,
  };
}
