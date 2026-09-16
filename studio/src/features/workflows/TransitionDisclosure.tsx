import type { IssueType, ScopedWorkflowSettings, State } from "../../shared/api/types";
import {
  SETTINGS_CHECKBOX_CLASS,
  SETTINGS_EYEBROW_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";
import type { useWorkflowEditorStore } from "./workflowEditorStore";

const controlKey = (...parts: string[]) => parts.join(":");

export function TransitionDisclosure({
  action,
  controlErrors,
  edge,
  expanded,
  issueType,
  onToggle,
  removeTransition,
  setTransitionPermission,
  source,
  target,
}: {
  action: string | null;
  controlErrors: Record<string, string>;
  edge: ScopedWorkflowSettings["transitions"][number];
  expanded: boolean;
  issueType: IssueType;
  onToggle: () => void;
  removeTransition: ReturnType<typeof useWorkflowEditorStore.getState>["removeTransition"];
  setTransitionPermission: ReturnType<
    typeof useWorkflowEditorStore.getState
  >["setTransitionPermission"];
  source: State;
  target: State;
}) {
  const sourceId = source.id as string;
  const targetId = target.id as string;
  const permissionControl = controlKey(
    "permission",
    issueType.id,
    sourceId,
    targetId,
  );
  const removeControl = controlKey("remove", issueType.id, sourceId, targetId);

  return (
    <li aria-label={`${source.name} to ${target.name} transition`}>
      <button
        type="button"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${source.name} to ${target.name}`}
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-2 px-2 py-2 text-left text-sm text-text-primary outline-none hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent"
      >
        <span className="min-w-24 flex-1 font-medium">{target.name}</span>
        <span className="border border-pane-border px-2 py-0.5 text-xs text-text-muted">
          {edge.agent_allowed ? "Agents + people" : "People only"}
        </span>
        <span aria-hidden="true" className={expanded ? "rotate-90 text-text-muted" : "text-text-muted"}>
          ›
        </span>
      </button>

      {expanded ? (
        <div className="space-y-5 border-t border-pane-border px-2 py-4">
          <section
            aria-label={`${source.name} to ${target.name} transition properties`}
            className="space-y-3"
          >
            <h4 className={SETTINGS_EYEBROW_CLASS}>Transition properties</h4>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  aria-label={`Agents may move ${source.name} to ${target.name}`}
                  checked={edge.agent_allowed}
                  disabled={action !== null}
                  className={SETTINGS_CHECKBOX_CLASS}
                  onChange={(event) => void setTransitionPermission(
                    issueType.id,
                    sourceId,
                    targetId,
                    event.target.checked,
                    permissionControl,
                  )}
                />
                Agents may make this move
              </label>
              <button
                type="button"
                aria-label={`Remove transition ${source.name} to ${target.name}`}
                disabled={action !== null}
                onClick={() => void removeTransition(
                  issueType.id,
                  sourceId,
                  targetId,
                  removeControl,
                )}
                className={settingsButtonClass("danger")}
              >
                Remove transition
              </button>
            </div>
            {controlErrors[permissionControl] || controlErrors[removeControl] ? (
              <SettingsStatusLine className="mt-1" tone="danger">
                {controlErrors[permissionControl] || controlErrors[removeControl]}
              </SettingsStatusLine>
            ) : null}
          </section>
        </div>
      ) : null}
    </li>
  );
}
