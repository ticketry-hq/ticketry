import { useState } from "react";

export type DraftUpdate<Draft> = Draft | ((current: Draft) => Draft);

export interface EditorDraft<Draft> {
  draft: Draft;
  dirty: boolean;
  hydrated: boolean;
  edit: (next: DraftUpdate<Draft>) => void;
  /**
   * Clears dirty for `identity` only when the draft still equals `sent`, then
   * shows `saved` (the authoritative response) in place of the sent value.
   */
  markSaved: (identity: string, sent: Draft, saved?: Draft) => void;
  discard: () => void;
}

interface DraftState<Draft> {
  identity: string;
  draft: Draft;
  hydrated: boolean;
  observed: Draft | undefined;
  dirty: boolean;
}

/**
 * A component-local draft that follows the authoritative value instead of
 * freezing whatever was loaded at mount. The draft is unsaved input only: it is
 * never written to a store or the Apollo cache and is lost on unmount.
 *
 * Editors are rendered once and reused across records and across the record's
 * own hydration, so seeding `useState` from props was a defect and not a
 * shortcut: a launch configuration form mounted before the workflow loaded, or
 * left over from another state, kept an empty prompt while showing a configured
 * binding. Saving from that form — a provider or model change is enough — wrote
 * the empty prompt over the stored one, and `LaunchPolicyResolver` then refused
 * every launch for that type and state with `prompt_not_configured`
 * (ticket #1372).
 *
 * The rules, which are part of the contract:
 * 1. An identity change resets the draft to that identity's value, not dirty.
 * 2. The first authoritative value for an unhydrated identity is adopted, not
 *    dirty.
 * 3. A later authoritative change is adopted only while the draft is clean, so
 *    a refresh or save round-trip never overwrites text still being typed.
 * 4. Marking a value saved clears dirty only while the draft still equals it.
 * 5. Discard restores the current authoritative value and clears dirty.
 */
export function useEditorDraft<Draft>(
  identity: string,
  authoritative: Draft | undefined,
  equals: (a: Draft, b: Draft) => boolean,
  empty: Draft,
): EditorDraft<Draft> {
  const stored = authoritative ?? empty;
  const fresh = (): DraftState<Draft> => ({
    identity,
    draft: stored,
    hydrated: authoritative !== undefined,
    observed: authoritative,
    dirty: false,
  });
  const [editor, setEditor] = useState(fresh);

  const sameObserved = (observed: Draft | undefined) =>
    observed === authoritative
    || (observed !== undefined && authoritative !== undefined
      && equals(observed, authoritative));

  let current = editor;
  if (
    editor.identity !== identity
    || (!editor.hydrated && authoritative !== undefined)
  ) {
    current = fresh();
  } else if (!sameObserved(editor.observed)) {
    current = {
      ...editor,
      draft: editor.dirty ? editor.draft : stored,
      observed: authoritative,
      dirty: editor.dirty && !equals(editor.draft, stored),
    };
  }
  if (current !== editor) setEditor(current);

  return {
    draft: current.draft,
    dirty: current.dirty,
    hydrated: current.hydrated,
    edit: (next) => {
      setEditor((state) => {
        const draft = typeof next === "function"
          ? (next as (value: Draft) => Draft)(state.draft)
          : next;
        const baseline = state.observed ?? empty;
        return { ...state, draft, dirty: !equals(draft, baseline) };
      });
    },
    markSaved: (savedIdentity, sent, saved) => {
      setEditor((state) =>
        state.identity === savedIdentity && equals(state.draft, sent)
          ? { ...state, draft: saved ?? state.draft, dirty: false }
          : state);
    },
    discard: () => {
      setEditor((state) => ({
        ...state,
        draft: state.observed ?? empty,
        dirty: false,
      }));
    },
  };
}
