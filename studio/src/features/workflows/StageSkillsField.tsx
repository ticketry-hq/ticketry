import { useId, useState } from "react";
import { SETTINGS_FIELD_CLASS } from "../../shared/ui/SettingsPrimitives";

interface StageSkillsFieldProps {
  onChange: (skills: string[]) => void;
  skills: string[];
}

export function StageSkillsField({
  onChange,
  skills,
}: StageSkillsFieldProps) {
  const inputId = useId();
  const [draft, setDraft] = useState("");

  const commit = () => {
    const name = draft.trim();
    if (!name || skills.includes(name)) return;
    setDraft("");
    onChange([...skills, name]);
  };

  return (
    <div className="grid gap-1 text-sm text-text-muted">
      <label htmlFor={inputId}>Skills</label>
      <p>
        Added to the task prompt for fresh starts and handoffs. Names are
        free-form and do not change required skills.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Selected skills">
        {skills.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 border border-pane-border bg-pane-bg px-2 py-1 text-sm text-text-primary"
          >
            {skill}
            <button
              type="button"
              aria-label={`Remove skill "${skill}"`}
              className="px-1 text-text-muted hover:text-lifecycle-danger focus:outline-none focus:ring-1 focus:ring-focus-accent"
              onClick={() => onChange(skills.filter((candidate) => candidate !== skill))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        id={inputId}
        aria-label="Skills"
        className={SETTINGS_FIELD_CLASS}
        placeholder="Add a skill"
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
    </div>
  );
}
