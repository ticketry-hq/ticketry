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
  const stagedStateIds = useWorkflowEditorStore((state) => state.stagedStateIds);
  const providerCapabilities = useWorkflowEditorStore(
    (state) => state.providerCapabilities,
  );
  const action = useWorkflowEditorStore((state) => state.action);
  const controlErrors = useWorkflowEditorStore((state) => state.controlErrors);
  const selectType = useWorkflowEditorStore((state) => state.selectType);
  const stageState = useWorkflowEditorStore((state) => state.stageState);
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
  const [expandedState, setExpandedState] = useState<{
    issueTypeId: string;
    stateId: string;
  } | null>(null);
  const [editingLaunch, setEditingLaunch] = useState<string | null>(null);
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
  const memberStateIds = useMemo(
    () => new Set(memberStates.flatMap((state) => state.id ? [state.id] : [])),
    [memberStates],
  );
  const catalogStates = useMemo(
    () => states.filter((state) => state.id && !memberStateIds.has(state.id)),
    [memberStateIds, states],
  );
  const stagedState = states.find((state) =>
    state.id === (selectedTypeId ? stagedStateIds[selectedTypeId] : undefined));
  const transitionTargetStates = stagedState
    ? [...memberStates, stagedState]
    : memberStates;

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
              setExpandedState(null);
              setEditingLaunch(null);
              void selectType(issueType.id);
            }}
            className={issueType.id === selectedTypeId
              ? "rounded-full border border-focus-accent bg-pane-title px-3.5 py-1.5 text-sm font-medium text-text-primary"
              : "rounded-full border border-pane-border px-3.5 py-1.5 text-sm text-text-muted hover:border-text-muted hover:text-text-primary"}
          >
            {issueType.name}
          </button>
        ))}
      </div>

      {selectedIssueType && workflow ? (
        <>
          <label className="grid max-w-sm gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
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
              className="rounded border border-pane-border bg-pane-panel px-3 py-2 text-sm font-normal normal-case tracking-normal text-text-primary"
            >
              <option value="">Select a start state</option>
              {states.map((state) => state.id ? (
                <option key={state.id} value={state.id}>{state.name}</option>
              ) : null)}
            </select>
            <InlineError message={controlErrors[controlKey("start", selectedIssueType.id)]} />
          </label>

          <label className="grid max-w-sm gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Add state to workflow
            <select
              aria-label="Add state to workflow"
              value={stagedState?.id ?? ""}
              disabled={action !== null || catalogStates.length === 0}
              onChange={(event) => {
                stageState(selectedIssueType.id, event.target.value || null);
              }}
              className="rounded border border-pane-border bg-pane-panel px-3 py-2 text-sm font-normal normal-case tracking-normal text-text-primary"
            >
              <option value="">
                {catalogStates.length > 0 ? "Choose a catalog state" : "All states are members"}
              </option>
              {catalogStates.map((state) => (
                <option key={state.id} value={state.id ?? ""}>{state.name}</option>
              ))}
            </select>
          </label>

          <ul aria-label={`${selectedIssueType.name} workflow states`} className="space-y-2">
            {memberStates.map((state) => {
              if (!state.id) return null;
              const expanded = expandedState?.issueTypeId === selectedIssueType.id
                && expandedState.stateId === state.id;
              return (
                <WorkflowStateRow
                  key={state.id}
                  action={action}
                  controlErrors={controlErrors}
                  editingLaunch={editingLaunch === state.id}
                  expanded={expanded}
                  issueType={selectedIssueType}
                  onEditLaunch={() => setEditingLaunch((current) =>
                    current === state.id ? null : state.id as string)}
                  onToggle={() => {
                    setEditingLaunch(null);
                    setExpandedState(expanded ? null : {
                      issueTypeId: selectedIssueType.id,
                      stateId: state.id as string,
                    });
                  }}
                  providerCapabilities={providerCapabilities}
                  state={state}
                  states={transitionTargetStates}
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
            {stagedState?.id ? (
              <PendingWorkflowStateRow
                action={action}
                addTransition={addTransition}
                controlErrors={controlErrors}
                issueType={selectedIssueType}
                memberStates={memberStates}
                state={stagedState}
              />
            ) : null}
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
            setExpandedState(null);
            setEditingLaunch(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface PendingWorkflowStateRowProps {
  action: string | null;
  addTransition: WorkflowStateRowProps["addTransition"];
  controlErrors: Record<string, string>;
  issueType: IssueType;
  memberStates: State[];
  state: State;
}

function PendingWorkflowStateRow({
  action,
  addTransition,
  controlErrors,
  issueType,
  memberStates,
  state,
}: PendingWorkflowStateRowProps) {
  const stateId = state.id as string;
  const [sourceId, setSourceId] = useState(memberStates[0]?.id ?? "");

  useEffect(() => {
    if (!memberStates.some((candidate) => candidate.id === sourceId)) {
      setSourceId(memberStates[0]?.id ?? "");
    }
  }, [memberStates, sourceId]);

  const control = controlKey("connect", issueType.id, stateId);

  return (
    <li
      aria-label={`${state.name} pending workflow state`}
      className="rounded border border-dashed border-focus-accent bg-pane-bg p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: state.color ?? "#7a8599" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{state.name}</span>
            <span className="rounded-full border border-focus-accent px-2 py-0.5 text-xs text-focus-accent">
              Pending
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Connect it from a workflow member to make it part of this workflow.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          aria-label={`Connect ${state.name} from`}
          value={sourceId}
          disabled={memberStates.length === 0 || action !== null}
          onChange={(event) => setSourceId(event.target.value)}
          className="min-w-48 flex-1 rounded border border-pane-border bg-pane-panel px-2 py-1.5 text-sm text-text-primary"
        >
          {memberStates.map((candidate) => (
            <option key={candidate.id} value={candidate.id ?? ""}>{candidate.name}</option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`Connect ${state.name}`}
          disabled={!sourceId || action !== null}
          onClick={() => void addTransition(
            issueType.id,
            sourceId,
            stateId,
            control,
          )}
          className="rounded border border-focus-accent px-3 py-1.5 text-sm text-focus-accent disabled:opacity-40"
        >
          Connect
        </button>
      </div>
      <InlineError message={controlErrors[control]} />
    </li>
  );
}

interface WorkflowStateRowProps {
  action: string | null;
  addTransition: ReturnType<typeof useWorkflowEditorStore.getState>["addTransition"];
  controlErrors: Record<string, string>;
  editingLaunch: boolean;
  expanded: boolean;
  issueType: IssueType;
  onEditLaunch: () => void;
  onToggle: () => void;
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

function WorkflowStateRow({
  action,
  addTransition,
  controlErrors,
  editingLaunch,
  expanded,
  issueType,
  onEditLaunch,
  onToggle,
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
}: WorkflowStateRowProps) {
  const stateId = state.id as string;
  const outgoing = workflow.transitions.filter((edge) =>
    edge.from_state_id === stateId);
  const binding = workflow.launch_bindings.find((candidate) =>
    candidate.state_id === stateId);
  const outgoingNames = outgoing.map((edge) =>
    states.find((candidate) => candidate.id === edge.to_state_id)?.name
      ?? "Unknown state");
  const autoControl = controlKey("auto", issueType.id, stateId);
  const subtreeControl = controlKey("subtree", issueType.id, stateId);
  const launchControl = controlKey("launch", issueType.id, stateId);
  const launchIsValid = validLaunchBinding(binding, providerCapabilities);

  return (
    <li
      aria-label={`${state.name} workflow state`}
      className="rounded border border-pane-border bg-pane-bg"
    >
      <button
        type="button"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${state.name}`}
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-text-primary"
      >
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: state.color ?? "#7a8599" }}
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{state.name}</span>
          <span className="ml-3 text-xs text-text-muted">
            Can move to: {outgoingNames.length > 0 ? outgoingNames.join(", ") : "None"}
          </span>
        </span>
        <span aria-hidden="true" className={expanded ? "rotate-90 text-text-muted" : "text-text-muted"}>
          ›
        </span>
      </button>

      {expanded ? (
        <div className="space-y-5 border-t border-pane-border p-3">
          <section aria-label={`${state.name} on entry`} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  On entry
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  {launchSummary(binding)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-text-primary">
                  <input
                    type="checkbox"
                    aria-label={`Run subtree ${state.name}`}
                    checked={binding?.subtree_run_enabled === true}
                    disabled={action !== null}
                    onChange={(event) => void setSubtreeRun(
                      issueType.id,
                      stateId,
                      event.target.checked,
                      subtreeControl,
                    )}
                  />
                  Run subtree
                </label>
                <label className="flex items-center gap-2 text-xs text-text-primary">
                  <input
                    type="checkbox"
                    aria-label={`Auto-start ${state.name}`}
                    checked={binding?.auto_start === true}
                    disabled={action !== null || (!launchIsValid && binding?.auto_start !== true)}
                    onChange={(event) => void setAutoStart(
                      issueType.id,
                      stateId,
                      event.target.checked,
                      autoControl,
                    )}
                  />
                  Auto-start
                </label>
                <button
                  type="button"
                  aria-label={`Edit launch for ${state.name}`}
                  onClick={onEditLaunch}
                  className="text-xs text-focus-accent hover:underline"
                >
                  {editingLaunch ? "Hide launch form" : "Edit launch"}
                </button>
              </div>
            </div>
            <InlineError message={controlErrors[autoControl]} />
            <InlineError message={controlErrors[subtreeControl]} />
            {editingLaunch ? (
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
            ) : null}
          </section>

          <TransitionEditor
            action={action}
            addTransition={addTransition}
            controlErrors={controlErrors}
            issueType={issueType}
            outgoing={outgoing}
            removeTransition={requestRemoveTransition}
            setTransitionPermission={setTransitionPermission}
            source={state}
            states={states}
          />
          {stateId !== workflow.start_state_id ? (
            <button
              type="button"
              aria-label={`Remove ${state.name} from workflow`}
              disabled={action !== null}
              onClick={() => void requestRemoveState(stateId, state.name)}
              className="text-sm text-red-300 hover:text-red-200 disabled:opacity-40"
            >
              Remove state from workflow
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

interface TransitionEditorProps {
  action: string | null;
  addTransition: WorkflowStateRowProps["addTransition"];
  controlErrors: Record<string, string>;
  issueType: IssueType;
  outgoing: ScopedWorkflowSettings["transitions"];
  removeTransition: WorkflowStateRowProps["requestRemoveTransition"];
  setTransitionPermission: WorkflowStateRowProps["setTransitionPermission"];
  source: State;
  states: State[];
}

function TransitionEditor({
  action,
  addTransition,
  controlErrors,
  issueType,
  outgoing,
  removeTransition,
  setTransitionPermission,
  source,
  states,
}: TransitionEditorProps) {
  const sourceId = source.id as string;
  const outgoingTargets = useMemo(
    () => new Set(outgoing.map((edge) => edge.to_state_id)),
    [outgoing],
  );
  const available = states.filter((candidate) =>
    candidate.id && !outgoingTargets.has(candidate.id));
  const [destination, setDestination] = useState(available[0]?.id ?? "");

  useEffect(() => {
    if (!available.some((candidate) => candidate.id === destination)) {
      setDestination(available[0]?.id ?? "");
    }
  }, [available, destination]);

  const addControl = controlKey("add", issueType.id, sourceId);

  return (
    <section aria-label={`${source.name} transitions`} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Can move to
      </h3>
      <ul className="space-y-2">
        {outgoing.map((edge) => {
          const target = states.find((candidate) => candidate.id === edge.to_state_id);
          const permissionControl = controlKey(
            "permission",
            issueType.id,
            sourceId,
            edge.to_state_id,
          );
          const removeControl = controlKey(
            "remove",
            issueType.id,
            sourceId,
            edge.to_state_id,
          );
          return (
            <li key={edge.to_state_id} className="rounded border border-pane-border bg-pane-panel px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-text-primary">
                  {target?.name ?? "Unknown state"}
                </span>
                <label className="flex items-center gap-2 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    aria-label={`Agents may move ${source.name} to ${target?.name ?? "Unknown state"}`}
                    checked={edge.agent_allowed}
                    disabled={action !== null}
                    onChange={(event) => void setTransitionPermission(
                      issueType.id,
                      sourceId,
                      edge.to_state_id,
                      event.target.checked,
                      permissionControl,
                    )}
                  />
                  Agents may do this
                </label>
                <button
                  type="button"
                  aria-label={`Remove transition ${source.name} to ${target?.name ?? "Unknown state"}`}
                  disabled={action !== null}
                  onClick={() => void removeTransition(
                    issueType.id,
                    sourceId,
                    edge.to_state_id,
                    removeControl,
                  )}
                  className="text-sm text-text-muted hover:text-red-300 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
              <InlineError message={
                controlErrors[permissionControl] || controlErrors[removeControl]
              } />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={`Add destination from ${source.name}`}
          value={destination}
          disabled={available.length === 0 || action !== null}
          onChange={(event) => setDestination(event.target.value)}
          className="min-w-48 flex-1 rounded border border-pane-border bg-pane-panel px-2 py-1.5 text-sm text-text-primary"
        >
          {available.length === 0 ? <option value="">All states added</option> : null}
          {available.map((candidate) => (
            <option key={candidate.id} value={candidate.id ?? ""}>{candidate.name}</option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`Add transition from ${source.name}`}
          disabled={!destination || action !== null}
          onClick={() => void addTransition(
            issueType.id,
            sourceId,
            destination,
            addControl,
          )}
          className="rounded border border-focus-accent px-3 py-1.5 text-sm text-focus-accent disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <InlineError message={controlErrors[addControl]} />
    </section>
  );
}

function validLaunchBinding(
  binding: ScopedWorkflowLaunchBinding | undefined,
  capabilities: WorkflowStateRowProps["providerCapabilities"],
): boolean {
  return Boolean(
    binding?.prompt.trim()
      && validateLaunchBindingOptions(binding, capabilities) === null,
  );
}

function launchSummary(binding: ScopedWorkflowLaunchBinding | undefined): string {
  if (!binding?.prompt.trim()) return "No launch configuration.";
  const provider = binding.agent ?? "No provider";
  const model = binding.model ? ` · ${binding.model}` : "";
  return `${provider}${model} · ${binding.prompt}`;
}

function InlineError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-1 text-xs text-red-300">{message}</p> : null;
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
      <div className="w-full max-w-lg space-y-4 rounded border border-pane-border bg-pane-bg p-5 shadow-xl">
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
            className="rounded border border-pane-border px-3 py-1.5 text-sm text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            {change.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function workflowMemberStateIds(workflow: ScopedWorkflowSettings): Set<string> {
  if (!workflow.start_state_id) return new Set();

  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.transitions) {
    const targets = outgoing.get(edge.from_state_id) ?? [];
    targets.push(edge.to_state_id);
    outgoing.set(edge.from_state_id, targets);
  }

  const members = new Set([workflow.start_state_id]);
  const queue = [workflow.start_state_id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of outgoing.get(queue[index]) ?? []) {
      if (members.has(target)) continue;
      members.add(target);
      queue.push(target);
    }
  }
  return members;
}
