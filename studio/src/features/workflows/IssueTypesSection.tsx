import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  IssueType,
  ScopedWorkflowImpact,
  ScopedWorkflowLaunchBinding,
  ScopedWorkflowImpactOperation,
  ScopedWorkflowSettings,
  State,
} from "../../shared/api/types";
import { LaunchConfigurationForm } from "./LaunchConfigurationForm";
import { validateLaunchBindingOptions } from "./launchBindingValidation";
import { useWorkflowEditorStore } from "./workflowEditorStore";
import { workflowMemberStateIds } from "./workflowMembership";
import {
  SETTINGS_CHECKBOX_CLASS,
  SETTINGS_EYEBROW_CLASS,
  SETTINGS_FIELD_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";

const controlKey = (...parts: string[]) => parts.join(":");

interface PendingWorkflowChange {
  title: string;
  confirmLabel: string;
  impact: ScopedWorkflowImpact;
  commit: () => Promise<void>;
}

export function IssueTypesSection() {
  const issueTypes = useWorkflowEditorStore((state) => state.issueTypes);
  const states = useWorkflowEditorStore((state) => state.states);
  const selectedTypeId = useWorkflowEditorStore((state) => state.selectedTypeId);
  const workflows = useWorkflowEditorStore((state) => state.workflows);
  const providerCapabilities = useWorkflowEditorStore(
    (state) => state.providerCapabilities,
  );
  const action = useWorkflowEditorStore((state) => state.action);
  const controlErrors = useWorkflowEditorStore((state) => state.controlErrors);
  const selectType = useWorkflowEditorStore((state) => state.selectType);
  const setStartState = useWorkflowEditorStore((state) => state.setStartState);
  const previewImpact = useWorkflowEditorStore((state) => state.previewImpact);
  const addTransition = useWorkflowEditorStore((state) => state.addTransition);
  const removeTransition = useWorkflowEditorStore((state) => state.removeTransition);
  const removeWorkflowState = useWorkflowEditorStore(
    (state) => state.removeWorkflowState,
  );
  const setTransitionPermission = useWorkflowEditorStore(
    (state) => state.setTransitionPermission,
  );
  const upsertLaunchBinding = useWorkflowEditorStore(
    (state) => state.upsertLaunchBinding,
  );
  const setAutoStart = useWorkflowEditorStore((state) => state.setAutoStart);
  const setSubtreeRun = useWorkflowEditorStore((state) => state.setSubtreeRun);
  const [expandedLaunchState, setExpandedLaunchState] = useState<string | null>(
    null,
  );
  const [expandedTransition, setExpandedTransition] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingWorkflowChange | null>(
    null,
  );

  const selectedIssueType = issueTypes.find((type) => type.id === selectedTypeId);
  const workflow = selectedTypeId ? workflows[selectedTypeId] : undefined;
  const memberStates = useMemo(() => {
    if (!workflow) return [];
    const memberIds = workflowMemberStateIds(workflow);
    return states.filter((state) => state.id && memberIds.has(state.id));
  }, [states, workflow]);

  const previewThenConfirm = async (
    operation: ScopedWorkflowImpactOperation,
    control: string,
    title: string,
    confirmLabel: string,
    commit: () => Promise<void>,
  ) => {
    if (!selectedIssueType) return;
    const impact = await previewImpact(selectedIssueType.id, operation, control);
    if (!impact) return;
    if (!hasDeletedConfiguration(impact)) {
      await commit();
      return;
    }
    setPendingChange({ title, confirmLabel, impact, commit });
  };
  return (
    <section aria-label="Issue Types" className="space-y-4">
      <div role="tablist" aria-label="Issue types" className="flex flex-wrap gap-2">
        {issueTypes.map((issueType) => (
          <button
            key={issueType.id}
            type="button"
            role="tab"
            aria-selected={issueType.id === selectedTypeId}
            disabled={action !== null}
            onClick={() => {
              setExpandedLaunchState(null);
              setExpandedTransition(null);
              void selectType(issueType.id);
            }}
            className={issueType.id === selectedTypeId
              ? "border border-focus-accent bg-pane-title px-3 py-1.5 text-sm font-medium text-text-primary"
              : "border border-pane-border px-3 py-1.5 text-sm text-text-muted hover:border-text-muted hover:text-text-primary"}
          >
            {issueType.name}
          </button>
        ))}
      </div>

      {selectedIssueType && workflow ? (
        <>
          <label className="grid max-w-sm gap-1 text-sm text-text-muted">
            Start State
            <select
              aria-label="Start State"
              value={workflow.start_state_id ?? ""}
              disabled={action !== null}
              onChange={(event) => {
                const key = controlKey("start", selectedIssueType.id);
                if (event.target.value) {
                  const stateId = event.target.value;
                  const stateName = states.find((state) => state.id === stateId)?.name
                    ?? "selected state";
                  void previewThenConfirm(
                    { operation: "set_start_state", state_id: stateId },
                    key,
                    `Set ${stateName} as the start state?`,
                    "Confirm start state",
                    () => setStartState(selectedIssueType.id, stateId, key),
                  );
                }
              }}
              className={SETTINGS_FIELD_CLASS}
            >
              <option value="">Select a start state</option>
              {states.map((state) => state.id ? (
                <option key={state.id} value={state.id}>{state.name}</option>
              ) : null)}
            </select>
            <InlineError message={controlErrors[controlKey("start", selectedIssueType.id)]} />
          </label>

          <ul aria-label={`${selectedIssueType.name} workflow states`} className="space-y-2">
            {memberStates.map((state) => {
              if (!state.id) return null;
              return (
                <WorkflowSourceGroup
                  key={state.id}
                  action={action}
                  controlErrors={controlErrors}
                  expandedLaunch={expandedLaunchState === state.id}
                  expandedTransition={expandedTransition}
                  issueType={selectedIssueType}
                  onToggleLaunch={() => setExpandedLaunchState((current) =>
                    current === state.id ? null : state.id)}
                  onToggleTransition={(key) => setExpandedTransition((current) =>
                    current === key ? null : key)}
                  providerCapabilities={providerCapabilities}
                  state={state}
                  states={states}
                  workflow={workflow}
                  addTransition={addTransition}
                  requestRemoveTransition={(
                    typeId,
                    fromStateId,
                    toStateId,
                    control,
                  ) => {
                    const fromName = states.find((candidate) =>
                      candidate.id === fromStateId)?.name ?? "state";
                    const toName = states.find((candidate) =>
                      candidate.id === toStateId)?.name ?? "state";
                    return previewThenConfirm(
                      {
                        operation: "remove_transition",
                        from_state_id: fromStateId,
                        to_state_id: toStateId,
                      },
                      control,
                      `Remove ${fromName} → ${toName}?`,
                      "Confirm removal",
                      () => removeTransition(
                        typeId,
                        fromStateId,
                        toStateId,
                        control,
                      ),
                    );
                  }}
                  requestRemoveState={(stateId, stateName) => {
                    const control = controlKey(
                      "remove-state",
                      selectedIssueType.id,
                      stateId,
                    );
                    return previewThenConfirm(
                      { operation: "remove_state", state_id: stateId },
                      control,
                      `Remove ${stateName} from this workflow?`,
                      "Confirm state removal",
                      () => removeWorkflowState(
                        selectedIssueType.id,
                        stateId,
                        control,
                      ),
                    );
                  }}
                  setAutoStart={setAutoStart}
                  setSubtreeRun={setSubtreeRun}
                  setTransitionPermission={setTransitionPermission}
                  upsertLaunchBinding={upsertLaunchBinding}
                />
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-text-muted">
          {action?.startsWith("load:")
            ? "Loading issue type workflow…"
            : "No issue type workflow is configured."}
        </p>
      )}
      {pendingChange ? (
        <WorkflowImpactDialog
          change={pendingChange}
          states={states}
          close={() => setPendingChange(null)}
          confirm={async () => {
            await pendingChange.commit();
            setPendingChange(null);
            setExpandedTransition(null);
          }}
        />
      ) : null}
    </section>
  );
}


interface WorkflowSourceGroupProps {
  action: string | null;
  addTransition: ReturnType<typeof useWorkflowEditorStore.getState>["addTransition"];
  controlErrors: Record<string, string>;
  expandedLaunch: boolean;
  expandedTransition: string | null;
  issueType: IssueType;
  onToggleLaunch: () => void;
  onToggleTransition: (key: string) => void;
  providerCapabilities: ReturnType<typeof useWorkflowEditorStore.getState>["providerCapabilities"];
  requestRemoveTransition: ReturnType<
    typeof useWorkflowEditorStore.getState
  >["removeTransition"];
  requestRemoveState: (stateId: string, stateName: string) => Promise<void>;
  setAutoStart: ReturnType<typeof useWorkflowEditorStore.getState>["setAutoStart"];
  setSubtreeRun: ReturnType<typeof useWorkflowEditorStore.getState>["setSubtreeRun"];
  setTransitionPermission: ReturnType<typeof useWorkflowEditorStore.getState>["setTransitionPermission"];
  state: State;
  states: State[];
  upsertLaunchBinding: ReturnType<typeof useWorkflowEditorStore.getState>["upsertLaunchBinding"];
  workflow: ScopedWorkflowSettings;
}

function WorkflowSourceGroup({
  action,
  addTransition,
  controlErrors,
  expandedLaunch,
  expandedTransition,
  issueType,
  onToggleLaunch,
  onToggleTransition,
  providerCapabilities,
  requestRemoveTransition,
  requestRemoveState,
  setAutoStart,
  setSubtreeRun,
  setTransitionPermission,
  state,
  states,
  upsertLaunchBinding,
  workflow,
}: WorkflowSourceGroupProps) {
  const stateId = state.id as string;
  const outgoing = workflow.transitions.filter((edge) =>
    edge.from_state_id === stateId);
  const binding = workflow.launch_bindings.find((candidate) =>
    candidate.state_id === stateId);

  return (
    <li
      aria-label={`${state.name} workflow state`}
      className="group/source border-b border-pane-border pb-4"
    >
      <div className="flex min-h-10 flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0"
          style={{ backgroundColor: state.color ?? "#7a8599" }}
        />
        <h3 className="min-w-0 flex-1 text-base font-semibold text-text-primary">
          {state.name}
        </h3>
        <button
          type="button"
          aria-label={`${expandedLaunch ? "Collapse" : "Expand"} ${state.name} launch configuration`}
          aria-expanded={expandedLaunch}
          onClick={onToggleLaunch}
          className={settingsButtonClass("secondary")}
        >
          Launch configuration
        </button>
        {stateId !== workflow.start_state_id ? (
          <button
            type="button"
            aria-label={`Remove ${state.name} from workflow`}
            disabled={action !== null}
            onClick={() => void requestRemoveState(stateId, state.name)}
            className={settingsButtonClass("danger")}
          >
            Remove state
          </button>
        ) : null}
      </div>

      {expandedLaunch ? (
        <StateLaunchConfiguration
          action={action}
          binding={binding}
          controlErrors={controlErrors}
          issueType={issueType}
          providerCapabilities={providerCapabilities}
          setAutoStart={setAutoStart}
          setSubtreeRun={setSubtreeRun}
          state={state}
          upsertLaunchBinding={upsertLaunchBinding}
        />
      ) : null}

      {outgoing.length > 0 ? (
        <ul
          aria-label={`${state.name} outgoing transitions`}
          className="ml-1 mt-1 space-y-1 border-l border-pane-border pl-5"
        >
          {outgoing.map((edge) => {
            const target = states.find((candidate) =>
              candidate.id === edge.to_state_id);
            if (!target?.id) return null;
            const transitionKey = controlKey(issueType.id, stateId, target.id);
            return (
              <TransitionDisclosure
                key={target.id}
                action={action}
                controlErrors={controlErrors}
                edge={edge}
                expanded={expandedTransition === transitionKey}
                issueType={issueType}
                onToggle={() => onToggleTransition(transitionKey)}
                removeTransition={requestRemoveTransition}
                setTransitionPermission={setTransitionPermission}
                source={state}
                target={target}
              />
            );
          })}
        </ul>
      ) : (
        <p className="ml-6 mt-1 text-sm text-text-muted">
          No outgoing transitions.
        </p>
      )}

      <div className="ml-6 mt-3">
        <AddDestination
          action={action}
          addTransition={addTransition}
          controlErrors={controlErrors}
          issueType={issueType}
          outgoing={outgoing}
          source={state}
          states={states}
        />
      </div>
    </li>
  );
}

interface TransitionDisclosureProps {
  action: string | null;
  controlErrors: Record<string, string>;
  edge: ScopedWorkflowSettings["transitions"][number];
  expanded: boolean;
  issueType: IssueType;
  onToggle: () => void;
  removeTransition: WorkflowSourceGroupProps["requestRemoveTransition"];
  setTransitionPermission: WorkflowSourceGroupProps["setTransitionPermission"];
  source: State;
  target: State;
}

function TransitionDisclosure({
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
}: TransitionDisclosureProps) {
  const sourceId = source.id as string;
  const targetId = target.id as string;
  const permissionControl = controlKey(
    "permission",
    issueType.id,
    sourceId,
    targetId,
  );
  const removeControl = controlKey(
    "remove",
    issueType.id,
    sourceId,
    targetId,
  );

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
        <TransitionTag>{edge.agent_allowed ? "Agents + people" : "People only"}</TransitionTag>
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
            <InlineError message={
              controlErrors[permissionControl] || controlErrors[removeControl]
            } />
          </section>
        </div>
      ) : null}
    </li>
  );
}

function StateLaunchConfiguration({
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
  providerCapabilities: WorkflowSourceGroupProps["providerCapabilities"];
  setAutoStart: WorkflowSourceGroupProps["setAutoStart"];
  setSubtreeRun: WorkflowSourceGroupProps["setSubtreeRun"];
  state: State;
  upsertLaunchBinding: WorkflowSourceGroupProps["upsertLaunchBinding"];
}) {
  const stateId = state.id as string;
  const autoControl = controlKey("auto", issueType.id, stateId);
  const subtreeControl = controlKey("subtree", issueType.id, stateId);
  const launchControl = controlKey("launch", issueType.id, stateId);
  const launchIsValid = validLaunchBinding(binding, providerCapabilities);

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
        <InlineError message={controlErrors[autoControl]} />
        <InlineError message={controlErrors[subtreeControl]} />
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

function TransitionTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-pane-border px-2 py-0.5 text-xs text-text-muted">
      {children}
    </span>
  );
}

interface AddDestinationProps {
  action: string | null;
  addTransition: WorkflowSourceGroupProps["addTransition"];
  controlErrors: Record<string, string>;
  issueType: IssueType;
  outgoing: ScopedWorkflowSettings["transitions"];
  source: State;
  states: State[];
}

function AddDestination({
  action,
  addTransition,
  controlErrors,
  issueType,
  outgoing,
  source,
  states,
}: AddDestinationProps) {
  const sourceId = source.id as string;
  const outgoingTargets = new Set(outgoing.map((edge) => edge.to_state_id));
  const available = states.filter((candidate) =>
    candidate.id && candidate.id !== sourceId && !outgoingTargets.has(candidate.id));
  const [adding, setAdding] = useState(false);
  const [destination, setDestination] = useState("");
  const addControl = controlKey("add", issueType.id, sourceId);

  useEffect(() => {
    if (!available.some((candidate) => candidate.id === destination)) {
      setDestination(available[0]?.id ?? "");
    }
  }, [available, destination]);

  if (!adding) {
    return (
      <button
        type="button"
        aria-label={`Add transition from ${source.name}`}
        disabled={available.length === 0 || action !== null}
        onClick={() => setAdding(true)}
        className={settingsButtonClass("secondary")}
      >
        + Add destination
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        autoFocus
        aria-label={`Add destination from ${source.name}`}
        value={destination}
        disabled={available.length === 0 || action !== null}
        onChange={(event) => setDestination(event.target.value)}
        className={`${SETTINGS_FIELD_CLASS} min-w-44`}
      >
        {available.map((candidate) => (
          <option key={candidate.id} value={candidate.id ?? ""}>{candidate.name}</option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`Create transition from ${source.name}`}
        disabled={!destination || action !== null}
        onClick={() => void addTransition(
          issueType.id,
          sourceId,
          destination,
          addControl,
        ).then(() => setAdding(false))}
        className={settingsButtonClass("primary")}
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setAdding(false)}
        className={settingsButtonClass("secondary")}
      >
        Cancel
      </button>
      <InlineError message={controlErrors[addControl]} />
    </div>
  );
}

function validLaunchBinding(
  binding: ScopedWorkflowLaunchBinding | undefined,
  capabilities: WorkflowSourceGroupProps["providerCapabilities"],
): boolean {
  return Boolean(
    binding?.prompt.trim()
      && validateLaunchBindingOptions(binding, capabilities) === null,
  );
}

function InlineError({ message }: { message?: string }) {
  return message ? (
    <SettingsStatusLine className="mt-1" tone="danger">
      {message}
    </SettingsStatusLine>
  ) : null;
}

function hasDeletedConfiguration(impact: ScopedWorkflowImpact): boolean {
  return impact.deleted_transitions.length > 0
    || impact.deleted_launch_bindings.length > 0
    || impact.disabled_auto_start_state_ids.length > 0;
}

function WorkflowImpactDialog({
  change,
  states,
  close,
  confirm,
}: {
  change: PendingWorkflowChange;
  states: State[];
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const stateName = (stateId: string) =>
    states.find((state) => state.id === stateId)?.name ?? stateId;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workflow deletion impact"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg space-y-4 border border-pane-border bg-pane-panel p-5 shadow-xl">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{change.title}</h2>
          <p className="mt-1 text-sm text-text-muted">
            This will delete the following type-specific transitions, launch prompts,
            and subtree-run capability.
          </p>
        </div>
        <ul aria-label="Configuration to delete" className="space-y-1 text-sm text-text-primary">
          {change.impact.deleted_transitions.map((edge) => (
            <li key={`${edge.from_state_id}:${edge.to_state_id}`}>
              Transition: {stateName(edge.from_state_id)} → {stateName(edge.to_state_id)}
            </li>
          ))}
          {change.impact.deleted_launch_bindings.map((binding) => (
            <Fragment key={`binding:${binding.state_id}`}>
              <li>Launch binding: {stateName(binding.state_id)}</li>
              {binding.subtree_run_enabled ? (
                <li>Subtree-run capability: {stateName(binding.state_id)}</li>
              ) : null}
            </Fragment>
          ))}
          {change.impact.disabled_auto_start_state_ids.map((stateId) => (
            <li key={`auto:${stateId}`}>Auto-start: {stateName(stateId)}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className={settingsButtonClass("secondary")}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            className={settingsButtonClass("danger-filled")}
          >
            {change.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
