import { InstantSettingsPanel } from "./InstantSettingsPanel";

export function ConversationConfigurationPanel({ onClose }: { onClose: () => void }) {
  return (
    <section
      role="region"
      aria-label="Conversation configuration"
      data-native-terminal-overlay
      className="absolute inset-0 z-[60] overflow-y-auto bg-pane-panel p-4 text-sm"
    >
      <header className="flex items-center justify-between gap-4 border-b border-pane-border pb-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
            Conversation configuration
          </p>
          <h1 className="text-lg font-bold text-text-primary">Conversations</h1>
        </div>
        <button
          type="button"
          aria-label="Close Conversation configuration"
          onClick={onClose}
          className="px-2 py-1 text-lg leading-none text-text-muted hover:bg-pane-title hover:text-text-primary"
        >
          ×
        </button>
      </header>
      <div className="mt-4">
        <InstantSettingsPanel focusPrompt showHeading={false} />
      </div>
    </section>
  );
}
