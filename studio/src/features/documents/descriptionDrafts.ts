import { apiErrorMessage } from "../../shared/api/errors";
import { createApolloStore } from "../../shared/apollo/localState";

interface DescriptionDraft {
  text: string;
  savedText: string;
  editing: boolean;
  requestId: string | null;
  savingText: string | null;
  saveRequested: boolean;
  error: string | null;
}

export const useDescriptionDrafts = createApolloStore<{
  drafts: Record<string, DescriptionDraft>;
}>("description-drafts", () => ({ drafts: {} }));

function patch(id: string, change: Partial<DescriptionDraft>): void {
  useDescriptionDrafts.setState(({ drafts }) => ({
    drafts: drafts[id] ? { ...drafts, [id]: { ...drafts[id], ...change } } : drafts,
  }));
}

export function discardDescriptionDraft(id: string): void {
  useDescriptionDrafts.setState(({ drafts }) => {
    const remaining = { ...drafts };
    delete remaining[id];
    return { drafts: remaining };
  });
}

export function openDescriptionDraft(id: string, text: string): void {
  useDescriptionDrafts.setState(({ drafts }) => ({
    drafts: {
      ...drafts,
      [id]: drafts[id]
        ? { ...drafts[id], editing: true }
        : { text, savedText: text, editing: true, requestId: null, savingText: null, saveRequested: false, error: null },
    },
  }));
}

export function editDescriptionDraft(id: string, text: string): void {
  patch(id, { text });
}

export function acceptDescriptionVersion(id: string, savedText: string, replace: boolean): void {
  patch(id, { savedText, ...(replace ? { text: savedText } : {}) });
}

/** Save boundaries share one request; edits made during it remain recoverable. */
export async function saveDescriptionDraft(
  id: string,
  onSave: (text: string) => Promise<unknown>,
  close = false,
): Promise<void> {
  if (close) patch(id, { editing: false });
  const draft = useDescriptionDrafts.getState().drafts[id];
  if (!draft) return;
  if (draft.requestId) {
    patch(id, { saveRequested: true });
    return;
  }
  if (draft.text === draft.savedText) {
    if (!draft.editing) discardDescriptionDraft(id);
    return;
  }
  const requestId = crypto.randomUUID();
  patch(id, { requestId, savingText: draft.text, saveRequested: false, error: null });
  try {
    await onSave(draft.text.trim());
  } catch (cause) {
    if (useDescriptionDrafts.getState().drafts[id]?.requestId !== requestId) return;
    patch(id, {
      requestId: null,
      savingText: null,
      editing: true,
      error: apiErrorMessage(cause instanceof Error ? cause : new Error(String(cause))),
    });
    return;
  }
  const current = useDescriptionDrafts.getState().drafts[id];
  if (current?.requestId !== requestId) return;
  patch(id, { savedText: draft.text, requestId: null, savingText: null });
  if (!current.editing && current.text === draft.text) {
    discardDescriptionDraft(id);
  } else if (current.saveRequested) {
    await saveDescriptionDraft(id, onSave);
  }
}
