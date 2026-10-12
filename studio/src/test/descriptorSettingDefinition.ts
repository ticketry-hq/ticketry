import type { SettingsEditorDefinition } from "../shared/editor-lifecycle";

/**
 * A test-only ordinary setting, declared exactly as a feature author would
 * declare a real one: its fields, their validation, a record-level rule and
 * equality. Its size is the measured authoring cost recorded in the capability
 * guide. It is never rendered by Studio itself.
 */
export interface ReviewerSetting {
  displayName: string;
  notifyOnSave: boolean;
}

export const EMPTY_REVIEWER_SETTING: ReviewerSetting = {
  displayName: "",
  notifyOnSave: false,
};

export const reviewerSettingDefinition: SettingsEditorDefinition<ReviewerSetting> = {
  empty: EMPTY_REVIEWER_SETTING,
  equals: (left, right) =>
    left.displayName === right.displayName && left.notifyOnSave === right.notifyOnSave,
  fields: [
    {
      key: "displayName",
      kind: "text",
      label: "Reviewer display name",
      heading: "Display name",
      description: "Shown next to every review you leave.",
      maxCharacters: 24,
      showCounter: true,
      placeholder: "For example: Release desk",
      validate: (value) => (value.trim() ? null : "Display name is required."),
    },
    {
      key: "notifyOnSave",
      kind: "checkbox",
      label: "Notify reviewers on save",
    },
  ],
  validateRecord: (draft) =>
    draft.notifyOnSave && draft.displayName.trim().length < 3
      ? "Notified reviewers need a display name of at least 3 characters."
      : null,
};
