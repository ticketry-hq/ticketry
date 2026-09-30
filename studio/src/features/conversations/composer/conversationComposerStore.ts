import { createApolloStore } from "../../../shared/apollo/localState";
import { useClientStore } from "../../../state/clientStore";
import { CONVERSATIONS_SECTION_ID } from "../../work-items";

interface ConversationComposerState {
  open: boolean;
  /** Kept across close so an accidental Escape never loses a typed prompt. */
  draft: string;
  openComposer: () => void;
  closeComposer: () => void;
  setDraft: (draft: string) => void;
}

/** Whether the Stories pane shows the inline "start with a prompt" composer. */
export const useConversationComposerStore = createApolloStore<ConversationComposerState>(
  "conversation-composer",
  (set) => ({
    open: false,
    draft: "",
    openComposer: () => set({ open: true }),
    closeComposer: () => set({ open: false }),
    setDraft: (draft) => set({ draft }),
  }),
);

/** Open the composer, expanding a collapsed Conversations section to show it. */
export function openConversationComposer(): void {
  const ui = useClientStore.getState();
  if (ui.collapsedStateIds.has(CONVERSATIONS_SECTION_ID)) {
    ui.toggleStateCollapsed(CONVERSATIONS_SECTION_ID);
  }
  useConversationComposerStore.getState().openComposer();
}
