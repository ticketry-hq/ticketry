import { useState } from "react";
import { ConversationInboxVariant } from "./ConversationInboxVariant";
import { ConversationListVariant } from "./ConversationListVariant";
import { ConversationTimelineVariant } from "./ConversationTimelineVariant";
import {
  CONVERSATION_DESIGN_VARIANTS,
  ConversationDesignSwitcher,
  type ConversationDesignVariant,
} from "./ConversationDesignSwitcher";

// Three Conversations designs, switchable with ?conversation-design=, inside the real Stories pane.
const readVariant = (): ConversationDesignVariant | null => {
  if (import.meta.env.PROD) return null;
  const value = new URLSearchParams(window.location.search).get(
    "conversation-design",
  );
  return CONVERSATION_DESIGN_VARIANTS.some((variant) => variant.key === value)
    ? value as ConversationDesignVariant
    : null;
};

export function hasConversationDesignPrototype(): boolean {
  return readVariant() !== null;
}

export function ConversationDesignPrototype() {
  const [variant, setVariant] = useState<ConversationDesignVariant>(
    () => readVariant() ?? "list",
  );

  const selectVariant = (next: ConversationDesignVariant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("conversation-design", next);
    window.history.replaceState(null, "", url);
    setVariant(next);
  };

  return (
    <>
      {variant === "list" ? <ConversationListVariant /> : null}
      {variant === "inbox" ? <ConversationInboxVariant /> : null}
      {variant === "timeline" ? <ConversationTimelineVariant /> : null}
      <ConversationDesignSwitcher current={variant} onChange={selectVariant} />
    </>
  );
}
