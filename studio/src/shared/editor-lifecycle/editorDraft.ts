import { useState } from "react";

interface DraftState<Draft> {
  identity: string;
  draft: Draft;
  hydrated: boolean;
  /** The authoritative value this draft last followed; unset until hydrated. */
  observed: Draft | undefined;
  dirty: boolean;
}

export interface EditorDraft<Draft> {
  draft: Draft;
  dirty: boolean;
  /** Replaces the draft with user input and marks it dirty. */
  edit: (next: Draft) => void;
  /**
   * Clears dirty when `identity` is still edited and the draft still equals
   * `sent`; the draft then shows `saved`, the authoritative saved value.
   */
  markSaved: (identity: string, sent: Draft, saved: Draft) => void;
  /** Restores the current authoritative value and clears dirty. */
  discard: () => void;
}

function followedState<Draft>(
  identity: string,
  authoritative: Draft | undefined,
  empty: Draft,
): DraftState<Draft> {
  return {
    identity,
    draft: authoritative ?? empty,
    hydrated: authoritative !== undefined,
    observed: authoritative,
    dirty: false,
  };
}

/**
 * A draft that follows the authoritative value instead of freezing whatever
 * was loaded at mount.
 *
 * Editors are rendered once and reused across records and across the record's
 * own hydration, so seeding `useState` from props was a defect and not a
 * shortcut: the launch configuration form, mounted before the workflow loaded
 * or left over from another state, kept an empty prompt while showing a
 * configured binding. Saving from that form — a provider or model change was
 * enough — wrote the empty prompt over the stored one, and
 * `LaunchPolicyResolver` then refused every launch for that type and state with
 * `prompt_not_configured` (ticket #1372).
 *
 * The draft therefore:
 * 1. resets to the authoritative value, clean, when the identity changes;
 * 2. adopts the first authoritative value of an unhydrated identity, clean;
 * 3. adopts a later authoritative change only while clean, so a refresh or a
 *    save round-trip never overwrites text still being typed;
 * 4. leaves dirty on `markSaved` unless the draft still equals what was sent;
 * 5. returns to the authoritative value, clean, on `discard`.
 *
 * The draft is component-local unsaved input; it is never written to a store
 * or to the Apollo cache.
 */
export function useEditorDraft<Draft>(
  identity: string,
  authoritative: Draft | undefined,
  empty: Draft,
  equals: (left: Draft, right: Draft) => boolean,
): EditorDraft<Draft> {
  const [state, setState] = useState(() =>
    followedState(identity, authoritative, empty));

  const edit = (next: Draft): void => {
    setState((current) => ({ ...current, draft: next, dirty: true }));
  };
  const markSaved = (savedIdentity: string, sent: Draft, saved: Draft): void => {
    setState((current) =>
      current.identity === savedIdentity && current.dirty && equals(current.draft, sent)
        ? { ...current, draft: saved, dirty: false }
        : current);
  };
  const discard = (): void => {
    setState((current) => ({
      ...current,
      draft: current.observed ?? empty,
      dirty: false,
    }));
  };
  const view = (next: DraftState<Draft>): EditorDraft<Draft> => ({
    draft: next.draft,
    dirty: next.dirty,
    edit,
    markSaved,
    discard,
  });

  if (state.identity !== identity) {
    const next = followedState(identity, authoritative, empty);
    setState(next);
    return view(next);
  }
  if (authoritative === undefined) return view(state);
  if (!state.hydrated) {
    const next = followedState(identity, authoritative, empty);
    setState(next);
    return view(next);
  }
  if (state.observed === undefined || !equals(state.observed, authoritative)) {
    const next = {
      ...state,
      draft: state.dirty ? state.draft : authoritative,
      observed: authoritative,
    };
    setState(next);
    return view(next);
  }
  return view(state);
}
