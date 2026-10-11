import { useState } from "react";
import { StoryWorkflowGuideDialog } from "../../features/workflows";
import { ModalShell } from "./ModalShell";
import { useModalStore } from "./modalStore";

const INVOKER_SELECTOR = {
  handoff: '[data-testid="onboarding-story-workflow-guide"]',
  toolbar: "[data-story-workflow-guide-toolbar]",
} as const;

export function StoryWorkflowGuideModal({
  storyId,
  source,
}: {
  storyId: string;
  source: "toolbar" | "handoff";
}) {
  const popModal = useModalStore((state) => state.popModal);
  // The invoking control focuses itself before opening. Retained Details
  // hosts can keep earlier, hidden copies of the toolbar trigger mounted, so
  // remember the exact invoker instead of the first matching element.
  const [invoker] = useState(() => {
    const focused = document.activeElement;
    return focused instanceof HTMLElement && focused.matches(INVOKER_SELECTOR[source])
      ? focused
      : null;
  });
  const closeGuide = () => {
    popModal();
    // Workspace focus effects can run while the modal closes. Return focus
    // after that commit, provided the invoking control still exists.
    requestAnimationFrame(() => {
      const target = invoker
        ? invoker.isConnected ? invoker : null
        : document.querySelector<HTMLElement>(INVOKER_SELECTOR[source]);
      target?.focus();
    });
  };
  return (
    <ModalShell title="Story workflow guide" width="w-[52rem] max-w-[calc(100vw-2rem)]" onClose={closeGuide}>
      <StoryWorkflowGuideDialog storyId={storyId} onClose={closeGuide} onDismiss={popModal} />
    </ModalShell>
  );
}
