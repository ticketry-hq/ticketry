/** A validation result: a user-facing message, or nothing when valid. */
export type ValidationMessage = string | null | undefined;

type KeysOfType<Draft, Value> = {
  [Key in keyof Draft]-?: Draft[Key] extends Value ? Key : never;
}[keyof Draft] & string;

interface FieldDescriptorBase {
  /** Accessible name of the control. */
  label: string;
  /** Optional visible heading above the control. */
  heading?: string;
  /** Optional help text under the heading. */
  description?: string;
}

/** A single-line or multi-line text control bound to a string field. */
export interface TextFieldDescriptor<Draft> extends FieldDescriptorBase {
  kind: "text" | "multiline";
  key: KeysOfType<Draft, string>;
  maxCharacters?: number;
  /** Shows a live "used / max" counter; requires `maxCharacters`. */
  showCounter?: boolean;
  placeholder?: string;
  /** Multi-line only: visible rows. */
  rows?: number;
  /** Multi-line only: render in the monospace face. */
  monospace?: boolean;
  validate?: (value: string, draft: Draft) => ValidationMessage;
}

/** A checkbox bound to a boolean field. */
export interface CheckboxFieldDescriptor<Draft> extends FieldDescriptorBase {
  kind: "checkbox";
  key: KeysOfType<Draft, boolean>;
  validate?: (value: boolean, draft: Draft) => ValidationMessage;
}

export type FieldDescriptor<Draft> =
  | TextFieldDescriptor<Draft>
  | CheckboxFieldDescriptor<Draft>;

/**
 * Everything an ordinary setting declares: the value shown before the saved
 * value arrives, draft equality, its fields and an optional record-level rule.
 */
export interface SettingsEditorDefinition<Draft> {
  empty: Draft;
  equals: (left: Draft, right: Draft) => boolean;
  fields: readonly FieldDescriptor<Draft>[];
  validateRecord?: (draft: Draft) => ValidationMessage;
}

/** The first field message in declaration order, then the record message. */
export function firstValidationMessage<Draft>(
  definition: Pick<SettingsEditorDefinition<Draft>, "fields" | "validateRecord">,
  draft: Draft,
): string | null {
  for (const field of definition.fields) {
    const message = field.kind === "checkbox"
      ? field.validate?.(draft[field.key] as boolean, draft)
      : field.validate?.(draft[field.key] as string, draft);
    if (message) return message;
  }
  return definition.validateRecord?.(draft) || null;
}
