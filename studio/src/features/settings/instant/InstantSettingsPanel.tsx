import { useEffect, useRef, useState } from "react";
import {
  SETTINGS_FIELD_CLASS,
  SETTINGS_SECTION_HEADING_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../../shared/ui/SettingsPrimitives";
import {
  DEFAULT_INSTANT_LAUNCH_SETTINGS,
  loadInstantLaunchSettings,
  saveInstantLaunchSettings,
  type InstantLaunchSettings,
} from "../instantLaunchSettings";

const MAX_INITIAL_PROMPT_CHARACTERS = 8_000;

function sameSettings(
  left: InstantLaunchSettings,
  right: InstantLaunchSettings,
): boolean {
  return left.initialPrompt === right.initialPrompt &&
    left.autoClose === right.autoClose;
}

export function InstantSettingsPanel({
  focusPrompt = false,
  showHeading = true,
}: {
  focusPrompt?: boolean;
  showHeading?: boolean;
}) {
  const [saved, setSaved] = useState(DEFAULT_INSTANT_LAUNCH_SETTINGS);
  const [draft, setDraft] = useState(DEFAULT_INSTANT_LAUNCH_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let current = true;
    void loadInstantLaunchSettings()
      .then((settings) => {
        if (!current) return;
        setSaved(settings);
        setDraft(settings);
      })
      .catch(() => {
        if (current) {
          setMessage({
            tone: "danger",
            text: "Conversation settings could not be loaded.",
          });
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusPrompt || loading) return;
    const frame = requestAnimationFrame(() => promptRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusPrompt, loading]);

  const dirty = !sameSettings(saved, draft);

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const persisted = await saveInstantLaunchSettings(draft);
      setSaved(persisted);
      setDraft(persisted);
      setMessage({ tone: "success", text: "Conversation settings saved." });
    } catch {
      setMessage({
        tone: "danger",
        text: "Conversation settings could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {showHeading ? (
        <header>
          <h2 className={SETTINGS_SECTION_HEADING_CLASS}>Conversations</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Defaults applied to every new conversation.
          </p>
        </header>
      ) : null}

      {message ? (
        <SettingsStatusLine tone={message.tone}>{message.text}</SettingsStatusLine>
      ) : null}

      <section className="space-y-2" aria-labelledby="instant-initial-prompt-heading">
        <div>
          <h3
            id="instant-initial-prompt-heading"
            className="text-sm font-semibold text-text-primary"
          >
            Starter prompt
          </h3>
          <p className="mt-0.5 text-sm text-text-muted">
            Add standing instructions for every new conversation.
          </p>
        </div>
        <textarea
          ref={promptRef}
          aria-label="Conversation starter prompt"
          value={draft.initialPrompt}
          maxLength={MAX_INITIAL_PROMPT_CHARACTERS}
          disabled={loading || saving}
          onChange={(event) => {
            setMessage(null);
            setDraft((current) => ({
              ...current,
              initialPrompt: event.target.value,
            }));
          }}
          rows={8}
          placeholder="For example: keep changes limited to the selected module."
          className={`${SETTINGS_FIELD_CLASS} w-full resize-y font-mono`}
        />
        <p className="text-right text-xs tabular-nums text-text-muted">
          {draft.initialPrompt.length.toLocaleString()} / {MAX_INITIAL_PROMPT_CHARACTERS.toLocaleString()}
        </p>
      </section>

      <div className="flex justify-end gap-2 border-t border-pane-border pt-4">
        <button
          type="button"
          disabled={loading || saving || !dirty}
          onClick={() => {
            setDraft(saved);
            setMessage(null);
          }}
          className={settingsButtonClass("secondary")}
        >
          Discard
        </button>
        <button
          type="button"
          aria-label="Save conversation settings"
          disabled={loading || saving || !dirty}
          onClick={() => void save()}
          className={settingsButtonClass("primary")}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
