import { useMemo, useState } from "react";
import { useWorkItems } from "../hooks";
import type { Label } from "../../../shared/api/types";
import { IconX } from "../../../shared/ui/icons";
import { GhostChipAdd, quietChipRemoveClassName } from "./QuietChipControls";

interface Props {
  /** The issue's current labels (chips, in order). */
  value: Label[];
  /** Replace-set callback with the new list of label names. */
  onChange: (names: string[]) => void;
  saving?: boolean;
}

// Labels-as-free-tags editor (G06): colored chips with × remove plus a typeable
// add control. Mirrors BlockerPicker's role but for a name-based replace-set —
// each edit recomputes the full name list and hands it to the patch. Match is
// case-sensitive exact (Jira semantics); a never-before-seen name is created on
// patch (name-based get-or-create server-side).
export default function LabelEditor({ value, onChange, saving }: Props) {
  const { items } = useWorkItems();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const names = value.map((l) => l.name);

  // Autocomplete pool: every label name already present across the loaded
  // project tree, minus those already on this issue. Free — no list endpoint.
  const suggestions = useMemo(() => {
    const here = new Set(names);
    const pool = new Set<string>();
    for (const it of items) {
      for (const l of it.labels) {
        if (!here.has(l.name)) pool.add(l.name);
      }
    }
    const q = draft.trim();
    const all = [...pool].sort((a, b) => a.localeCompare(b));
    return q ? all.filter((n) => n.toLowerCase().includes(q.toLowerCase())) : all;
  }, [items, names, draft]);

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || names.includes(trimmed)) {
      setDraft("");
      setEditing(false);
      return;
    }
    onChange([...names, trimmed]);
    setDraft("");
    setEditing(false);
  };

  const cancel = () => {
    setDraft("");
    setEditing(false);
  };

  const remove = (name: string) =>
    onChange(names.filter((n) => n !== name));

  return (
    <div className="flex flex-wrap items-center justify-start gap-1" data-testid="label-editor">
      {value.map((l) => (
        <span
          key={l.name}
          data-testid="label-chip"
          className="group inline-flex items-center gap-1 rounded-full border border-pane-border bg-pane-title px-2 py-0.5 text-xs text-text-primary"
        >
          <span
            data-testid="label-swatch"
            className="h-2 w-2 flex-none rounded-full"
            style={{ backgroundColor: l.color || "#5a6273" }}
          />
          {l.name}
          <button
            type="button"
            disabled={saving}
            aria-label={`Remove label ${l.name}`}
            data-testid="remove-label"
            onClick={() => remove(l.name)}
            className={quietChipRemoveClassName}
          >
            <IconX size={12} />
          </button>
        </span>
      ))}
      {editing ? (
        <input
          autoFocus
          disabled={saving}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={cancel}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          list="label-suggestions"
          placeholder="Add label…"
          data-testid="add-label"
          className="w-24 min-w-0 rounded border border-pane-border bg-pane-bg px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-focus-accent"
        />
      ) : (
        <GhostChipAdd
          disabled={saving}
          label="Add label"
          onClick={() => setEditing(true)}
        />
      )}
      <datalist id="label-suggestions">
        {suggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}
