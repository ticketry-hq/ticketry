import {
  SettingsStatusLine,
  settingsButtonClass,
} from "../ui/SettingsPrimitives";
import { DescriptorFields } from "./DescriptorFields";
import { useEditorLifecycle, type EditorStatus, type SaveMode } from "./editorLifecycle";
import {
  validateDraft,
  type EditorDefinition,
  type EditorMessages,
} from "./fieldDescriptors";
import { saveErrorMessage } from "./saveErrorMessage";
import type { SaveBinding } from "./saveSequencing";

interface DescriptorEditorProps<Draft> {
  definition: EditorDefinition<Draft>;
  identity: string;
  authoritative: Draft | undefined;
  loading?: boolean;
  loadError?: unknown;
  mode: SaveMode;
  save: SaveBinding<Draft, Draft>;
}

/**
 * An ordinary setting rendered from its declarations: fields, feedback and,
 * in commit mode, Save and Discard. Autosave editors save on checkbox change
 * and when a text field is left.
 */
export function DescriptorEditor<Draft>({
  authoritative,
  definition,
  identity,
  loadError,
  loading,
  mode,
  save,
}: DescriptorEditorProps<Draft>) {
  const editor = useEditorLifecycle<Draft>({
    identity,
    authoritative,
    equals: definition.equals,
    empty: definition.empty,
    loading,
    loadError,
    validate: (draft) => validateDraft(definition, draft),
    mode,
    save,
  });
  const { status } = editor;
  const feedback = editorFeedback(status, definition.messages);
  const commitMode = mode === "commit";

  return (
    <div className="space-y-5">
      {feedback ? (
        <SettingsStatusLine tone={feedback.tone}>{feedback.text}</SettingsStatusLine>
      ) : null}
      <DescriptorFields
        fields={definition.fields}
        draft={editor.draft}
        disabled={status.loading}
        onChange={editor.edit}
        onCommitField={commitMode ? undefined : (draft) => void editor.save(draft)}
      />
      {commitMode ? (
        <div className="flex justify-end gap-2 border-t border-pane-border pt-4">
          <button
            type="button"
            disabled={!status.canDiscard}
            onClick={editor.discard}
            className={settingsButtonClass("secondary")}
          >
            Discard
          </button>
          <button
            type="button"
            aria-label={definition.saveLabel}
            disabled={!status.canSave}
            onClick={() => void editor.save()}
            className={settingsButtonClass("primary")}
          >
            {status.saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : status.saving ? (
        <p className="text-sm text-text-muted">Applying…</p>
      ) : null}
    </div>
  );
}

function editorFeedback(
  status: EditorStatus,
  messages: EditorMessages,
): { tone: "success" | "danger"; text: string } | null {
  if (status.loadError !== undefined && status.loadError !== null) {
    return { tone: "danger", text: messages.loadFailed };
  }
  if (status.outcome.kind === "failed") {
    return {
      tone: "danger",
      text: messages.saveFailed ?? saveErrorMessage(status.outcome.error),
    };
  }
  if (status.validation) return { tone: "danger", text: status.validation };
  if (status.outcome.kind === "saved") return { tone: "success", text: messages.saved };
  return null;
}
