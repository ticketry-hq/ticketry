import type { EditorDefinition } from "../shared/editorLifecycle";

// Test-only "representative new ordinary setting" (CODING-2729). It is made of
// declarations alone — fields, validation and feedback wording — and is the
// measured authoring cost recorded in docs/feature-map/how-to-add-a-capability.md.

export interface DigestSetting {
  title: string;
  shared: boolean;
}

export const digestSettingEditor: EditorDefinition<DigestSetting> = {
  fields: [
    {
      key: "title",
      kind: "text",
      label: "Digest title",
      heading: "Title",
      description: "Shown at the top of every digest.",
      maxCharacters: 40,
      counter: true,
      placeholder: "Weekly digest",
      validate: (title) => {
        if (!title.trim()) return "A digest title is required.";
        return title.trim().length < 3
          ? "A digest title needs at least 3 characters."
          : null;
      },
    },
    {
      key: "shared",
      kind: "checkbox",
      label: "Share digest with the team",
    },
  ],
  validate: (digest) =>
    digest.shared && digest.title.trim().toLowerCase() === "private"
      ? "A shared digest cannot be titled “private”."
      : null,
  equals: (a, b) => a.title === b.title && a.shared === b.shared,
  empty: { title: "", shared: false },
  saveLabel: "Save digest settings",
  messages: {
    saved: "Digest settings saved.",
    loadFailed: "Digest settings could not be loaded.",
  },
};
