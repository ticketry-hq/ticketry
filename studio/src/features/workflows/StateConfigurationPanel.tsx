import { useEffect, useMemo, useState } from "react";
import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
} from "../../shared/api/types";
import {
  SETTINGS_CHECKBOX_CLASS,
  SettingsStatusLine,
} from "../../shared/ui/SettingsPrimitives";
import { LaunchConfigurationForm } from "./LaunchConfigurationForm";
import { validateLaunchBindingOptions } from "./launchBindingValidation";
import { useStudioStore } from "../projects/store";
import { useWorkflowEditorStore } from "./workflowEditorStore";
import { workflowMemberStateIds } from "./workflowMembership";

const launchControl = (typeId: string, stateId: string) =>
  `launch:${typeId}:${stateId}`;

/**
 * State-scoped policy lives over, rather than inside, a selected Story's
 * workspace. Subsequent configuration slices add their controls here without
 * changing the workspace's terminal and document lifetime.
 */
export function StateConfigurationPanel({
  state,
  onClose,
}: {
  state: State;
  onClose: () => void;
}) {
  const selectedProjectId = useStudioStore((store) => store.selectedProjectId);
  const issueTypes = useWorkflowEditorStore((store) => store.issueTypes);
  const states = useWorkflowEditorStore((store) => store.states);
  const workflows = useWorkflowEditorStore((store) => store.workflows);
  const providerCapabilities = useWorkflowEditorStore(
    (store) => store.providerCapabilities,
  );
  const loading = useWorkflowEditorStore((store) => store.loading);
  const action = useWorkflowEditorStore((store) => store.action);
  const notice = useWorkflowEditorStore((store) => store.notice);
  const error = useWorkflowEditorStore((store) => store.error);
  const controlErrors = useWorkflowEditorStore((store) => store.controlErrors);
  const load = useWorkflowEditorStore((store) => store.load);
  const loadWorkflows = useWorkflowEditorStore((store) => store.loadWorkflows);
  const upsertLaunchBinding = useWorkflowEditorStore(
    (store) => store.upsertLaunchBinding,
  );
  const setTransitionPermission = useWorkflowEditorStore(
    (store) => store.setTransitionPermission,
  );
  const setAutoStart = useWorkflowEditorStore((store) => store.setAutoStart);
  const setSubtreeRun = useWorkflowEditorStore((store) => store.setSubtreeRun);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const stateId = state.id;

  useEffect(() => {
    if (!selectedProjectId) return;
    let disposed = false;
    const prepare = async () => {
      if (useWorkflowEditorStore.getState().projectId !== selectedProjectId) {
        await load(selectedProjectId);
      }
      if (disposed) return;
      const typeIds = useWorkflowEditorStore.getState().issueTypes
        .filter((type) => type.level === "task")
        .map((type) => type.id);
      await loadWorkflows(typeIds);
    };
    void prepare();
    return () => {
      disposed = true;
    };
  }, [load, loadWorkflows, selectedProjectId]);

  const eligibleTypes = useMemo(() => {
    if (!stateId) return [];
    return [...issueTypes]
      .filter((type) => type.level === "task")
      .sort((left, right) => left.sort_order - right.sort_order)
      .filter((type) => {
        const workflow = workflows[type.id];
        return workflow ? workflowMemberStateIds(workflow).has(stateId) : false;
      });
  }, [issueTypes, stateId, workflows]);
  const defaultTypeId = eligibleTypes.find((type) => type.name === "Story")?.id
    ?? eligibleTypes[0]?.id
    ?? null;

  useEffect(() => {
    setSelectedTypeId(defaultTypeId);
  }, [defaultTypeId, stateId]);

  const selectedType = eligibleTypes.find((type) => type.id === selectedTypeId)
    ?? null;
  const selectedWorkflow = selectedType ? workflows[selectedType.id] : undefined;
  const binding = selectedWorkflow?.launch_bindings.find((candidate) =>
    candidate.state_id === stateId);
  const pendingWorkflows = issueTypes.some((type) =>
    type.level === "task" && !workflows[type.id]);
  const isLoading = !error && (
    loading || action?.startsWith("load:") || pendingWorkflows
  );

  return (
    <section
      aria-label={`${state.name} state configuration`}
      data-testid="state-configuration-panel"
      className="absolute inset-0 z-[60] overflow-y-auto bg-pane-panel p-4 text-sm"
    >
      <header className="flex items-center justify-between gap-4 border-b border-pane-border pb-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-text-muted uppercase">
            State configuration
          </p>
          <h1 className="text-lg font-bold text-text-primary">{state.name}</h1>
        </div>
        <button
          type="button"
          aria-label={`Close ${state.name} state configuration`}
          onClick={onClose}
          className="px-2 py-1 text-lg leading-none text-text-muted hover:bg-pane-title hover:text-text-primary"
        >
          ×
        </button>
      </header>
      {error ? (
        <SettingsStatusLine className="mt-4" tone="danger">
          {error}
        </SettingsStatusLine>
      ) : isLoading ? (
        <p className="mt-4 text-text-muted">Loading workflow policy…</p>
      ) : eligibleTypes.length === 0 ? (
        <p className="mt-4 text-text-muted">
          No workflow is available for this state.
        </p>
      ) : selectedType && selectedWorkflow && stateId ? (
        <StateLaunchBindingEditor
          key={`${selectedType.id}:${stateId}`}
          binding={binding}
          action={action}
          controlErrors={controlErrors}
          error={controlErrors[launchControl(selectedType.id, stateId)]}
          issueType={selectedType}
          onSelectType={setSelectedTypeId}
          providerCapabilities={providerCapabilities}
          save={(input) => upsertLaunchBinding(
            selectedType.id,
            stateId,
            input,
            launchControl(selectedType.id, stateId),
          )}
          selectedTypeId={selectedType.id}
          setAutoStart={setAutoStart}
          setSubtreeRun={setSubtreeRun}
          setTransitionPermission={setTransitionPermission}
          state={state}
          states={states}
          types={eligibleTypes}
          workflow={selectedWorkflow}
        />
      ) : null}
      {notice ? (
        <SettingsStatusLine className="mt-4" tone="attention">
          {notice}
        </SettingsStatusLine>
      ) : null}
    </section>
  );
}

function StateLaunchBindingEditor({
  action,
  binding,
  controlErrors,
  error,
  issueType,
  onSelectType,
  providerCapabilities,
  save,
  selectedTypeId,
  setAutoStart,
  setSubtreeRun,
  setTransitionPermission,
  state,
  states,
  types,
  workflow,
}: {
  action: string | null;
  binding: ReturnType<typeof useWorkflowEditorStore.getState>["workflows"][string]["launch_bindings"][number] | undefined;
  controlErrors: Record<string, string>;
  error?: string;
  issueType: IssueType;
  onSelectType: (typeId: string) => void;
  providerCapabilities: ReturnType<typeof useWorkflowEditorStore.getState>["providerCapabilities"];
  save: Parameters<typeof LaunchConfigurationForm>[0]["save"];
  selectedTypeId: string;
  setAutoStart: ReturnType<typeof useWorkflowEditorStore.getState>["setAutoStart"];
  setSubtreeRun: ReturnType<typeof useWorkflowEditorStore.getState>["setSubtreeRun"];
  setTransitionPermission: ReturnType<typeof useWorkflowEditorStore.getState>["setTransitionPermission"];
  state: State;
  states: State[];
  types: IssueType[];
  workflow: ScopedWorkflowSettings;
}) {
  return (
    <div className="mt-4 space-y-5">
      <section aria-label={`${state.name} issue type`} className="space-y-3">
        <h2 className="text-base font-semibold text-text-primary">Issue type</h2>
        <div
          role="tablist"
          aria-label="Issue types"
          className="flex flex-wrap gap-2"
        >
          {types.map((type) => (
            <button
              key={type.id}
              type="button"
              role="tab"
              aria-selected={type.id === selectedTypeId}
              onClick={() => onSelectType(type.id)}
              className={type.id === selectedTypeId
                ? "border border-focus-accent bg-pane-title px-3 py-1.5 text-sm font-medium text-text-primary"
                : "border border-pane-border px-3 py-1.5 text-sm text-text-muted hover:border-text-muted hover:text-text-primary"}
            >
              {type.name}
            </button>
          ))}
        </div>
      </section>
      <section aria-label={`${state.name} launch configuration`}>
        <h2 className="text-base font-semibold text-text-primary">
          Launch configuration
        </h2>
        <LaunchConfigurationForm
          binding={binding}
          error={error}
          issueType={issueType}
          promptRows={14}
          providerCapabilities={providerCapabilities}
          save={save}
          state={state}
        />
      </section>
      <StateTransitions
        action={action}
        controlErrors={controlErrors}
        issueType={issueType}
        setTransitionPermission={setTransitionPermission}
        state={state}
        states={states}
        workflow={workflow}
      />
      <StateEntryAutomation
        action={action}
        binding={binding}
        controlErrors={controlErrors}
        issueType={issueType}
        providerCapabilities={providerCapabilities}
        setAutoStart={setAutoStart}
        setSubtreeRun={setSubtreeRun}
        state={state}
      />
    </div>
  );
}

function StateEntryAutomation({
  action,
  binding,
  controlErrors,
  issueType,
  providerCapabilities,
  setAutoStart,
  setSubtreeRun,
  state,
}: {
  action: string | null;
  binding: ReturnType<typeof useWorkflowEditorStore.getState>["workflows"][string]["launch_bindings"][number] | undefined;
  controlErrors: Record<string, string>;
  issueType: IssueType;
  providerCapabilities: ReturnType<typeof useWorkflowEditorStore.getState>["providerCapabilities"];
  setAutoStart: ReturnType<typeof useWorkflowEditorStore.getState>["setAutoStart"];
  setSubtreeRun: ReturnType<typeof useWorkflowEditorStore.getState>["setSubtreeRun"];
  state: State;
}) {
  const stateId = state.id as string;
  const autoControl = `auto:${issueType.id}:${stateId}`;
  const subtreeControl = `subtree:${issueType.id}:${stateId}`;
  const launchIsValid = Boolean(
    binding?.prompt.trim()
      && validateLaunchBindingOptions(binding, providerCapabilities) === null,
  );

  return (
    <section aria-label={`${state.name} entry automation`} className="space-y-3">
      <h2 className="text-base font-semibold text-text-primary">
        Auto-start and Run subtree
      </h2>
      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            aria-label={`Auto-start ${state.name}`}
            checked={binding?.auto_start === true}
            disabled={action === autoControl || (!launchIsValid && binding?.auto_start !== true)}
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
        <label className="flex items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            aria-label={`Run subtree ${state.name}`}
            checked={binding?.subtree_run_enabled === true}
            disabled={action === subtreeControl}
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
      </div>
      {controlErrors[autoControl] ? (
        <SettingsStatusLine tone="danger">{controlErrors[autoControl]}</SettingsStatusLine>
      ) : null}
      {controlErrors[subtreeControl] ? (
        <SettingsStatusLine tone="danger">{controlErrors[subtreeControl]}</SettingsStatusLine>
      ) : null}
    </section>
  );
}

function StateTransitions({
  action,
  controlErrors,
  issueType,
  setTransitionPermission,
  state,
  states,
  workflow,
}: {
  action: string | null;
  controlErrors: Record<string, string>;
  issueType: IssueType;
  setTransitionPermission: ReturnType<typeof useWorkflowEditorStore.getState>["setTransitionPermission"];
  state: State;
  states: State[];
  workflow: ScopedWorkflowSettings;
}) {
  const stateId = state.id as string;
  const names = new Map(states.flatMap((candidate) =>
    candidate.id ? [[candidate.id, candidate.name]] : []));
  const transitions = workflow.transitions.filter((edge) =>
    edge.from_state_id === stateId || edge.to_state_id === stateId);

  return (
    <section aria-label={`${state.name} transitions`} className="space-y-3">
      <h2 className="text-base font-semibold text-text-primary">Transitions</h2>
      {transitions.length > 0 ? (
        <ul className="space-y-2">
          {transitions.map((edge) => {
            const direction = edge.from_state_id === stateId ? "Outgoing" : "Incoming";
            const fromName = names.get(edge.from_state_id) ?? edge.from_state_id;
            const toName = names.get(edge.to_state_id) ?? edge.to_state_id;
            const control = `permission:${issueType.id}:${edge.from_state_id}:${edge.to_state_id}`;
            return (
              <li
                key={`${edge.from_state_id}:${edge.to_state_id}`}
                aria-label={`${direction} ${fromName} to ${toName}`}
                className="space-y-2 border border-pane-border p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold tracking-wider text-text-muted uppercase">
                    {direction}
                  </span>
                  <span className="min-w-0 flex-1 text-text-primary">
                    {fromName} → {toName}
                  </span>
                  <label className="flex items-center gap-2 text-text-primary">
                    <input
                      type="checkbox"
                      aria-label={`Agents may move ${fromName} to ${toName}`}
                      checked={edge.agent_allowed}
                      disabled={action === control}
                      className={SETTINGS_CHECKBOX_CLASS}
                      onChange={(event) => void setTransitionPermission(
                        issueType.id,
                        edge.from_state_id,
                        edge.to_state_id,
                        event.target.checked,
                        control,
                      )}
                    />
                    {edge.agent_allowed ? "Agents + people" : "People only"}
                  </label>
                </div>
                {controlErrors[control] ? (
                  <SettingsStatusLine tone="danger">
                    {controlErrors[control]}
                  </SettingsStatusLine>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-text-muted">No transitions touch this state.</p>
      )}
    </section>
  );
}
