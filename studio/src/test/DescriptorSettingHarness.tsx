import {
  DescriptorFields,
  saveErrorMessage,
  useSettingsEditor,
  type SaveBinding,
} from "../shared/editor-lifecycle";
import {
  SettingsStatusLine,
  settingsButtonClass,
} from "../shared/ui/SettingsPrimitives";
import {
  reviewerSettingDefinition,
  type ReviewerSetting,
} from "./descriptorSettingDefinition";

/**
 * Renders the test-only setting the way a feature panel would: the shared
 * lifecycle, the descriptor renderer and surface wording. It owns no draft,
 * dirty, sequencing or identity logic of its own.
 */
export function DescriptorSettingHarness({
  authoritative,
  identity,
  loadError,
  loading = false,
  mode = "commit",
  save,
}: {
  authoritative: ReviewerSetting | undefined;
  identity: string;
  loadError?: unknown;
  loading?: boolean;
  mode?: "commit" | "autosave";
  save: SaveBinding<ReviewerSetting>;
}) {
  const editor = useSettingsEditor(reviewerSettingDefinition, {
    authoritative,
    identity,
    loadError,
    loading,
    save,
  });
  const { status } = editor;
  const blocked = status.loading || status.saving || !status.dirty;

  return (
    <form aria-label="Reviewer settings" onSubmit={(event) => event.preventDefault()}>
      {status.loadError !== undefined ? (
        <SettingsStatusLine tone="danger">Reviewer settings could not be loaded.</SettingsStatusLine>
      ) : null}
      {status.validation ? (
        <SettingsStatusLine tone="attention">{status.validation}</SettingsStatusLine>
      ) : null}
      {status.outcome.kind === "saved" ? (
        <SettingsStatusLine tone="success">Reviewer settings saved.</SettingsStatusLine>
      ) : null}
      {status.outcome.kind === "failed" ? (
        <SettingsStatusLine tone="danger">{saveErrorMessage(status.outcome.error)}</SettingsStatusLine>
      ) : null}
      {status.saving ? <p role="status">Saving…</p> : null}

      <DescriptorFields
        fields={reviewerSettingDefinition.fields}
        draft={editor.draft}
        disabled={status.loading}
        onChange={(next) => {
          editor.edit(next);
          if (mode === "autosave") void editor.autosave(next);
        }}
      />

      {mode === "commit" ? (
        <div>
          <button
            type="button"
            disabled={blocked}
            onClick={editor.discard}
            className={settingsButtonClass("secondary")}
          >
            Discard
          </button>
          <button
            type="button"
            disabled={blocked || status.validation !== null}
            onClick={() => void editor.commit()}
            className={settingsButtonClass("primary")}
          >
            Save
          </button>
        </div>
      ) : null}
    </form>
  );
}
