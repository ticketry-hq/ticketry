import { useEffect } from "react";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import {
  ConversationComposer,
  useConversationComposerStore,
  useEndedConversationsToday,
} from "../../../../../features/conversations";
import { useStudioStore } from "../../../../../features/projects";
import { CONVERSATIONS_SECTION_ID } from "../../../../../features/work-items";
import { useClientStore } from "../../../../../state/clientStore";
import { selectPlanningRowId } from "../internal/instantRunTicketNavigation";
import { StateHeaderRow } from "./StateHeaderRow";

/**
 * The Conversations section header: collapses like a state header, opens the
 * inline composer beneath itself, and links to today's ended conversations,
 * which resume from the conversation workspace's dormant tabs.
 */
export function ConversationsHeaderRow({
  count,
  onConfigure,
}: {
  count: number;
  onConfigure: () => void;
}) {
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const collapsed = useClientStore((s) =>
    s.collapsedStateIds.has(CONVERSATIONS_SECTION_ID),
  );
  const toggleStateCollapsed = useClientStore((s) => s.toggleStateCollapsed);
  const composerOpen = useConversationComposerStore((s) => s.open);
  const closeComposer = useConversationComposerStore((s) => s.closeComposer);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const endedToday = useEndedConversationsToday(selectedProjectId, selectedModuleId);

  // A composer belongs to the module it was opened in.
  useEffect(() => closeComposer, [closeComposer, selectedModuleId]);

  return (
    <>
      <StateHeaderRow
        stateName="Conversations"
        stateColor=""
        count={count}
        isCollapsed={collapsed}
        onToggle={toggleStateCollapsed}
        onConfigureSection={onConfigure}
        stateId={null}
        sectionId={CONVERSATIONS_SECTION_ID}
        sectionActions={
          endedToday > 0 ? (
            <button
              type="button"
              title="Open the conversation workspace to resume one"
              onClick={() => selectPlanningRowId(TEMP_TASK_ID)}
              className="ml-1 shrink-0 px-1 text-xs font-normal text-text-muted hover:text-text-primary"
            >
              {endedToday} ended today
            </button>
          ) : null
        }
      />
      {composerOpen && !collapsed ? <ConversationComposer /> : null}
    </>
  );
}
