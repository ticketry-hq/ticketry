import { StoryWorkflowGuideDialog } from "../../features/workflows";
import { ModalShell } from "./ModalShell";
import { useModalStore } from "./modalStore";

export function StoryWorkflowGuideModal({
  storyId,
  source,
}: {
  storyId: string;
  source: "toolbar" | "handoff";
}) {
  const popModal = useModalStore((state) => state.popModal);
  const closeGuide = () => {
    popModal();
    // Workspace focus effects can run while the modal closes. Return focus
    // after that commit, provided the invoking control still exists.
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(source === "handoff"
        ? '[data-testid="onboarding-story-workflow-guide"]'
        : "[data-story-workflow-guide-toolbar]")?.focus();
    });
  };
  return (
    <ModalShell title="Story workflow guide" width="w-[52rem] max-w-[calc(100vw-2rem)]" onClose={closeGuide}>
      <StoryWorkflowGuideDialog storyId={storyId} onClose={closeGuide} onDismiss={popModal} />
    </ModalShell>
  );
}
