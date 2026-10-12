/** A draft message: the reason a value cannot be saved, or nothing. */
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

/** A single-line or multi-line text control over a string draft field. */
export interface TextFieldDescriptor<Draft> extends FieldDescriptorBase {
  key: KeysOfType<Draft, string>;
  kind: "text" | "multiline";
  maxCharacters?: number;
  /** Shows a live "used / maximum" counter; needs `maxCharacters`. */
  counter?: boolean;
  placeholder?: string;
  /** Visible rows of a multi-line control. */
  rows?: number;
  /** Renders a multi-line control in the monospace face. */
  monospace?: boolean;
  validate?: (value: string, draft: Draft) => ValidationMessage;
}

/** A checkbox over a boolean draft field. */
export interface CheckboxFieldDescriptor<Draft>
  extends FieldDescriptorBase {
  key: KeysOfType<Draft, boolean>;
  kind: "checkbox";
  validate?: (value: boolean, draft: Draft) => ValidationMessage;
}

export type FieldDescriptor<Draft> =
  | TextFieldDescriptor<Draft>
  | CheckboxFieldDescriptor<Draft>;

/** Feedback wording; the lifecycle supplies states, the surface supplies text. */
export interface EditorMessages {
  saved: string;
  loadFailed: string;
  /** Fixed failure wording; defaults to the save error's own message. */
  saveFailed?: string;
}

/** Everything an ordinary setting declares; the shared lifecycle does the rest. */
export interface EditorDefinition<Draft> {
  fields: FieldDescriptor<Draft>[];
  /** Record-level rule over the whole draft, checked after the field rules. */
  validate?: (draft: Draft) => ValidationMessage;
  equals: (a: Draft, b: Draft) => boolean;
  /** The draft shown before the authoritative value has arrived. */
  empty: Draft;
  /** Accessible name of the explicit Save button. */
  saveLabel: string;
  messages: EditorMessages;
}

/** The first field message in declaration order, else the record message. */
export function validateDraft<Draft>(
  definition: Pick<EditorDefinition<Draft>, "fields" | "validate">,
  draft: Draft,
): string | null {
  for (const field of definition.fields) {
    const message = field.kind === "checkbox"
      ? field.validate?.(draft[field.key] as boolean, draft)
      : field.validate?.(draft[field.key] as string, draft);
    if (message) return message;
  }
  return definition.validate?.(draft) || null;
}
