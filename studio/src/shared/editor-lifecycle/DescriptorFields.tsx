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
  fields: readonly FieldDescriptor<Draft>[];
  draft: Draft;
  disabled?: boolean;
  onChange: (next: Draft) => void;
}

/** Draws declared fields with the Settings field classes. */
export function DescriptorFields<Draft>({
  disabled = false,
  draft,
  fields,
  onChange,
}: DescriptorFieldsProps<Draft>) {
  return (
    <>
      {fields.map((field) => (
        <DescriptorField
          key={field.key}
          field={field}
          draft={draft}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </>
  );
}

function DescriptorField<Draft>({
  disabled,
  draft,
  field,
  onChange,
}: {
  field: FieldDescriptor<Draft>;
  draft: Draft;
  disabled: boolean;
  onChange: (next: Draft) => void;
}) {
  const headingId = useId();
  const control = field.kind === "checkbox"
    ? <CheckboxControl field={field} draft={draft} disabled={disabled} onChange={onChange} />
    : <TextControl field={field} draft={draft} disabled={disabled} onChange={onChange} />;
  if (!field.heading) return control;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="text-sm font-semibold text-text-primary">
          {field.heading}
        </h3>
        {field.description ? (
          <p className="mt-0.5 text-sm text-text-muted">{field.description}</p>
        ) : null}
      </div>
      {control}
    </section>
  );
}

function TextControl<Draft>({
  disabled,
  draft,
  field,
  onChange,
}: {
  field: TextFieldDescriptor<Draft>;
  draft: Draft;
  disabled: boolean;
  onChange: (next: Draft) => void;
}) {
  const value = draft[field.key] as string;
  const update = (next: string) => onChange({ ...draft, [field.key]: next });
  const shared = {
    "aria-label": field.label,
    value,
    maxLength: field.maxCharacters,
    disabled,
    placeholder: field.placeholder,
  };
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
      {field.showCounter && field.maxCharacters !== undefined ? (
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
}: {
  field: CheckboxFieldDescriptor<Draft>;
  draft: Draft;
  disabled: boolean;
  onChange: (next: Draft) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        aria-label={field.label}
        checked={draft[field.key] as boolean}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, [field.key]: event.target.checked })}
        className={SETTINGS_CHECKBOX_CLASS}
      />
      {field.label}
    </label>
  );
}
