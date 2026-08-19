import { useState } from "react";
import { IconPencil } from "../../../../../shared/ui/icons";

export default function NameEditor({
  name,
  saving,
  onSave,
}: {
  name: string;
  saving: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  // Reset the draft when the server name changes, during render instead of
  // in an effect — avoids painting a stale draft frame first.
  const [lastName, setLastName] = useState(name);
  if (name !== lastName) {
    setLastName(name);
    setValue(name);
  }

  if (!editing) {
    return (
      <h2
        className="group inline-flex cursor-text items-center gap-2 text-lg font-semibold leading-snug text-text-primary hover:opacity-90"
        onClick={() => setEditing(true)}
        data-testid="issue-name"
      >
        {name}
        <IconPencil
          size={14}
          className="flex-none text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
        {saving && <span className="text-xs font-normal text-text-muted">saving…</span>}
      </h2>
    );
  }
  const commit = () => {
    setEditing(false);
    if (value.trim() && value !== name) onSave(value.trim());
  };
  return (
    <input
      aria-label="Name"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setValue(name);
          setEditing(false);
        }
      }}
      className="w-full border border-pane-border bg-pane-bg px-2 py-1 text-lg font-semibold text-text-primary outline-none focus:border-focus-accent"
    />
  );
}
