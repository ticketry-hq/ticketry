import { useEffect } from "react";

export const CONVERSATION_DESIGN_VARIANTS = [
  { key: "list", label: "Chat list" },
  { key: "inbox", label: "Attention inbox" },
  { key: "timeline", label: "Status timeline" },
] as const;

export type ConversationDesignVariant =
  (typeof CONVERSATION_DESIGN_VARIANTS)[number]["key"];

interface ConversationDesignSwitcherProps {
  current: ConversationDesignVariant;
  onChange: (variant: ConversationDesignVariant) => void;
}

export function ConversationDesignSwitcher({
  current,
  onChange,
}: ConversationDesignSwitcherProps) {
  const currentIndex = CONVERSATION_DESIGN_VARIANTS.findIndex(
    (variant) => variant.key === current,
  );
  const cycle = (offset: number) => {
    const nextIndex = (
      currentIndex + offset + CONVERSATION_DESIGN_VARIANTS.length
    ) % CONVERSATION_DESIGN_VARIANTS.length;
    onChange(CONVERSATION_DESIGN_VARIANTS[nextIndex].key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const selected = CONVERSATION_DESIGN_VARIANTS[currentIndex];
  return (
    <div
      aria-label="Conversation design options"
      className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center border border-focus-accent bg-pane-bg shadow-lg"
    >
      <button
        type="button"
        aria-label="Previous conversation design"
        className="px-3 py-2 text-focus-accent hover:bg-pane-title"
        onClick={() => cycle(-1)}
      >
        ←
      </button>
      <div className="min-w-44 border-x border-pane-border px-3 py-2 text-center font-mono text-xs text-text-primary">
        {currentIndex + 1}/{CONVERSATION_DESIGN_VARIANTS.length} · {selected.label}
      </div>
      <button
        type="button"
        aria-label="Next conversation design"
        className="px-3 py-2 text-focus-accent hover:bg-pane-title"
        onClick={() => cycle(1)}
      >
        →
      </button>
    </div>
  );
}
