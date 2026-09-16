import type { IssueType, ScopedWorkflowLaunchBinding, State } from "../../shared/api/types";
import {
  SETTINGS_CHECKBOX_CLASS,
  SETTINGS_EYEBROW_CLASS,
  SettingsStatusLine,
} from "../../shared/ui/SettingsPrimitives";
import { LaunchConfigurationForm } from "./LaunchConfigurationForm";
import { validateLaunchBindingOptions } from "./launchBindingValidation";
import type { useWorkflowEditorStore } from "./workflowEditorStore";

type EditorState = ReturnType<typeof useWorkflowEditorStore.getState>;
const controlKey = (...parts: string[]) => parts.join(":");

export function StateLaunchConfiguration({
  action,
  binding,
  controlErrors,
  issueType,
  providerCapabilities,
  setAutoStart,
  setSubtreeRun,
  state,
  upsertLaunchBinding,
}: {
  action: string | null;
  binding?: ScopedWorkflowLaunchBinding;
  controlErrors: Record<string, string>;
  issueType: IssueType;
  providerCapabilities: EditorState["providerCapabilities"];
  setAutoStart: EditorState["setAutoStart"];
  setSubtreeRun: EditorState["setSubtreeRun"];
  state: State;
  upsertLaunchBinding: EditorState["upsertLaunchBinding"];
}) {
  const stateId = state.id as string;
  const autoControl = controlKey("auto", issueType.id, stateId);
  const subtreeControl = controlKey("subtree", issueType.id, stateId);
  const launchControl = controlKey("launch", issueType.id, stateId);
  const launchIsValid = Boolean(
    binding?.prompt.trim()
      && validateLaunchBindingOptions(binding, providerCapabilities) === null,
  );
  const error = (control: string) => controlErrors[control] ? (
    <SettingsStatusLine className="mt-1" tone="danger">
      {controlErrors[control]}
    </SettingsStatusLine>
  ) : null;

  return (
    <section
      aria-label={`${state.name} state launch settings`}
      className="ml-6 mt-2 space-y-5 border border-pane-border px-3 py-4"
    >
      <section aria-label={`${state.name} on entry`} className="space-y-3">
        <h4 className={SETTINGS_EYEBROW_CLASS}>On entry · {state.name}</h4>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              aria-label={`Run subtree ${state.name}`}
              checked={binding?.subtree_run_enabled === true}
              disabled={action !== null}
              className={SETTINGS_CHECKBOX_CLASS}
              onChange={(event) => void setSubtreeRun(
                issueType.id,
                stateId,
                event.target.checked,
                subtreeControl,
              )}
            />
            Run subtree
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              aria-label={`Auto-start ${state.name}`}
              checked={binding?.auto_start === true}
              disabled={action !== null || (!launchIsValid && binding?.auto_start !== true)}
              className={SETTINGS_CHECKBOX_CLASS}
              onChange={(event) => void setAutoStart(
                issueType.id,
                stateId,
                event.target.checked,
                autoControl,
              )}
            />
            Auto-start
          </label>
        </div>
        {error(autoControl)}
        {error(subtreeControl)}
      </section>

      <section aria-label={`${state.name} launch configuration`}>
        <h4 className={SETTINGS_EYEBROW_CLASS}>Launch configuration</h4>
        <LaunchConfigurationForm
          binding={binding}
          error={controlErrors[launchControl]}
          issueType={issueType}
          providerCapabilities={providerCapabilities}
          save={(input) => upsertLaunchBinding(
            issueType.id,
            stateId,
            input,
            launchControl,
          )}
          state={state}
        />
      </section>
    </section>
  );
}
