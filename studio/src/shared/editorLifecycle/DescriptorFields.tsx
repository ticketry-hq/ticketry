import { useId } from "react";
import {
  SETTINGS_CHECKBOX_CLASS,
  SETTINGS_FIELD_CLASS,
} from "../ui/SettingsPrimitives";
import type {
  CheckboxFieldDescriptor,
  FieldDescriptor,
  TextFieldDescriptor,
} from "./fieldDescriptors";

interface DescriptorFieldsProps<Draft> {
  fields: FieldDescriptor<Draft>[];
  draft: Draft;
  disabled?: boolean;
  onChange: (next: Draft) => void;
  /** A text field was left; autosave editors save here. */
  onCommitField?: (draft: Draft) => void;
}

/** Draws declared ordinary controls with the existing Settings field classes. */
export function DescriptorFields<Draft>({
  disabled = false,
  draft,
  fields,
  onChange,
  onCommitField,
}: DescriptorFieldsProps<Draft>) {
  const idPrefix = useId();
  return (
    <>
      {fields.map((field) => {
        const headingId = `${idPrefix}-${field.key}-heading`;
        const control = field.kind === "checkbox"
          ? (
            <CheckboxControl
              field={field}
              draft={draft}
              disabled={disabled}
              onChange={(next) => {
                onChange(next);
                onCommitField?.(next);
              }}
            />
          )
          : (
            <TextControl
              field={field}
              draft={draft}
              disabled={disabled}
              onChange={onChange}
              onBlur={() => onCommitField?.(draft)}
            />
          );
        return (
          <section
            key={field.key}
            className="space-y-2"
            aria-labelledby={field.heading ? headingId : undefined}
          >
            {field.heading || field.description ? (
              <div>
                {field.heading ? (
                  <h3 id={headingId} className="text-sm font-semibold text-text-primary">
                    {field.heading}
                  </h3>
                ) : null}
                {field.description ? (
                  <p className="mt-0.5 text-sm text-text-muted">{field.description}</p>
                ) : null}
              </div>
            ) : null}
            {control}
          </section>
        );
      })}
    </>
  );
}

interface ControlProps<Draft, Field> {
  field: Field;
  draft: Draft;
  disabled: boolean;
  onChange: (next: Draft) => void;
}

function TextControl<Draft>({
  disabled,
  draft,
  field,
  onBlur,
  onChange,
}: ControlProps<Draft, TextFieldDescriptor<Draft>> & { onBlur: () => void }) {
  const value = draft[field.key] as string;
  const shared = {
    "aria-label": field.label,
    value,
    maxLength: field.maxCharacters,
    disabled,
    placeholder: field.placeholder,
    onBlur,
  };
  const update = (next: string) => onChange({ ...draft, [field.key]: next });
  return (
    <>
      {field.kind === "multiline" ? (
        <textarea
          {...shared}
          rows={field.rows}
          onChange={(event) => update(event.target.value)}
          className={`${SETTINGS_FIELD_CLASS} w-full resize-y${field.monospace ? " font-mono" : ""}`}
        />
      ) : (
        <input
          {...shared}
          type="text"
          onChange={(event) => update(event.target.value)}
          className={`${SETTINGS_FIELD_CLASS} w-full`}
        />
      )}
      {field.counter && field.maxCharacters !== undefined ? (
        <p className="text-right text-xs tabular-nums text-text-muted">
          {value.length.toLocaleString()} / {field.maxCharacters.toLocaleString()}
        </p>
      ) : null}
    </>
  );
}

function CheckboxControl<Draft>({
  disabled,
  draft,
  field,
  onChange,
}: ControlProps<Draft, CheckboxFieldDescriptor<Draft>>) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        checked={draft[field.key] as boolean}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...draft, [field.key]: event.target.checked })}
        className={SETTINGS_CHECKBOX_CLASS}
      />
      {field.label}
    </label>
  );
}
