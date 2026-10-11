import { useId, useState } from "react";
import { SETTINGS_FIELD_CLASS } from "../../shared/ui/SettingsPrimitives";
import { SkillAvailabilitySummary } from "./SkillAvailabilitySummary";
import {
  hasSkillName,
  type SkillAvailabilityEntry,
  type SkillAvailabilityView,
} from "./skillAvailability";

interface StageSkillsFieldProps {
  availability?: SkillAvailabilityView;
  kind?: "stage" | "required";
  onChange: (skills: string[]) => void;
  skills: string[];
}

function chipStatus(
  entry: SkillAvailabilityEntry | undefined,
  provider: string | null,
  checking: boolean,
): { label: string; tone: string } | null {
  if (!entry) return checking ? { label: "Checking…", tone: "text-text-muted" } : null;
  if (entry.status === "available" && provider) {
    const spelling = entry.installed_name && entry.installed_name !== entry.requested
      ? ` as ${entry.installed_name}`
      : "";
    return { label: `Available to ${provider}${spelling}`, tone: "text-text-muted" };
  }
  if (entry.status === "missing" && provider) {
    return { label: `Missing for ${provider}`, tone: "text-lifecycle-danger" };
  }
  return { label: "Not verified", tone: "text-lifecycle-attention" };
}

export function StageSkillsField({
  availability,
  kind = "stage",
  onChange,
  skills,
}: StageSkillsFieldProps) {
  const required = kind === "required";
  const label = required ? "Required skills" : "Skills";
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const result = availability?.result ?? null;
  const entries = new Map(result?.skills.map((entry) => [entry.requested, entry]));

  const commit = () => {
    const name = draft.trim();
    if (!name || hasSkillName(skills, name)) return;
    setDraft("");
    onChange([...skills, name]);
  };

  return (
    <div className="grid gap-1 text-sm text-text-muted">
      <label htmlFor={inputId}>{label}</label>
      <p>
        {required
          ? "Required for launch. Names must be in the pinned required-skill allow-list; disk availability does not change that gate."
          : "Added to the task prompt for fresh starts and handoffs. Names are free-form and do not change required skills."}
      </p>
      <ul className="flex flex-wrap gap-2" aria-label={required ? "Selected required skills" : "Selected skills"}>
        {skills.map((skill) => {
          const status = availability
            ? chipStatus(entries.get(skill), result?.provider ?? null, availability.checking)
            : null;
          return (
            <li
              key={skill}
              aria-label={`${required ? "Required skill" : "Skill"} ${skill}`}
              className="inline-flex items-center gap-1 border border-pane-border bg-pane-bg px-2 py-1 text-sm text-text-primary"
            >
              {skill}
              {status ? (
                <span className={`text-xs ${status.tone}`}>{status.label}</span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${required ? "required skill" : "skill"} "${skill}"`}
                className="px-1 text-text-muted hover:text-lifecycle-danger focus:outline-none focus:ring-1 focus:ring-focus-accent"
                onClick={() => onChange(skills.filter((candidate) => candidate !== skill))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {availability && skills.length > 0 ? (
        <SkillAvailabilitySummary availability={availability} required={required} />
      ) : null}
      <input
        id={inputId}
        aria-label={label}
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
