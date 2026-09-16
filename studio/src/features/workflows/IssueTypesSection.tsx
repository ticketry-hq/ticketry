import { useEffect, useMemo, useState } from "react";
import type {
  IssueType,
  ScopedWorkflowImpact,
  ScopedWorkflowImpactOperation,
  ScopedWorkflowSettings,
  State,
} from "../../shared/api/types";
import { useWorkflowEditorStore } from "./workflowEditorStore";
import { workflowMemberStateIds } from "./workflowMembership";
import { StateLaunchConfiguration } from "./StateLaunchConfiguration";
import { TransitionDisclosure } from "./TransitionDisclosure";
import {
  WorkflowImpactDialog,
  type PendingWorkflowChange,
} from "./WorkflowImpactDialog";
import {
  SETTINGS_FIELD_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";

const controlKey = (...parts: string[]) => parts.join(":");

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
