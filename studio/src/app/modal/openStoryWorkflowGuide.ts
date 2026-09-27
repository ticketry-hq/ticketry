import { useModalStore } from "./modalStore";

/** Shared entry for Details and the onboarding handoff. */
export function openStoryWorkflowGuide(
  storyId: string,
  source: "toolbar" | "handoff" = "toolbar",
): void {
  const modal = useModalStore.getState();
  if (modal.modalStack.length > 0) return;
  modal.pushModal({
    type: "story-workflow-guide",
    payload: { storyId, source },
  });
}
