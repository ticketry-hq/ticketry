import { useRef, useState } from "react";
import { ApiError, apiErrorMessage } from "../../shared/api/client";
import type { State, StateImpact } from "../../shared/api/types";
import { STATE_GROUP_ORDER } from "../../shared/utilities/display";
import {
  SETTINGS_FIELD_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../shared/ui/SettingsPrimitives";
import { useWorkflowEditorStore } from "./workflowEditorStore";
import { loadStateImpact } from "./queries";

const GROUP_LABELS: Record<string, string> = {
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function StateCatalog() {
  const states = useWorkflowEditorStore((state) => state.states);
  const projectId = useWorkflowEditorStore((state) => state.projectId);
  const stateWorkItemCounts = useWorkflowEditorStore(
    (state) => state.stateWorkItemCounts,
  );
  const action = useWorkflowEditorStore((state) => state.action);
  const createState = useWorkflowEditorStore((state) => state.createState);
  const updateState = useWorkflowEditorStore((state) => state.updateState);
  const removeState = useWorkflowEditorStore((state) => state.removeState);
  const moveState = useWorkflowEditorStore((state) => state.moveState);
  const reorderState = useWorkflowEditorStore((state) => state.reorderState);
  const [draggedStateId, setDraggedStateId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<string>(STATE_GROUP_ORDER[0]);
  const [previewStateId, setPreviewStateId] = useState<string | null>(null);
  const [impact, setImpact] = useState<StateImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impactConflict, setImpactConflict] = useState<string | null>(null);
  const previewGeneration = useRef(0);

  const submit = async () => {
    const stateName = name.trim();
    if (!stateName) return;
    await createState(stateName, group);
    setName("");
    setAdding(false);
  };

  const preview = async (stateId: string) => {
    if (!projectId) return;
    const generation = ++previewGeneration.current;
    setPreviewStateId(stateId);
    setImpact(null);
    setImpactError(null);
    setImpactConflict(null);
    setImpactLoading(true);
    try {
      const nextImpact = await loadStateImpact(projectId, stateId);
      if (previewGeneration.current !== generation) return;
      setImpact(nextImpact);
    } catch (error) {
      if (previewGeneration.current !== generation) return;
      const failure = classifyImpactFailure(error);
      setImpactConflict(failure.conflict);
      setImpactError(failure.error);
    } finally {
      if (previewGeneration.current === generation) setImpactLoading(false);
    }
  };

  const previewState = states.find((state) => state.id === previewStateId);
  const hardBlocked = (impact?.protection_rules?.length ?? 0) > 0;

  const confirmRemoval = async () => {
    if (!impact || !previewState || impact.state_id !== previewStateId) return;
    setImpactError(null);
    setImpactConflict(null);
    try {
      await removeState({
        stateId: impact.state_id,
        stateName: previewState.name,
      });
      previewGeneration.current += 1;
      setPreviewStateId(null);
      setImpact(null);
    } catch (error) {
      const failure = classifyImpactFailure(error);
      setImpactConflict(failure.conflict);
      setImpactError(failure.error);
    }
  };

  return (
    <>
      <ul className="mt-4 space-y-2">
        {states.map((state, index) => state.id ? (
          <CatalogStateRow
            key={state.id}
            action={action}
            index={index}
            moveState={moveState}
            onDropState={() => {
              if (draggedStateId) void reorderState(draggedStateId, state.id as string);
              setDraggedStateId(null);
            }}
            onRemove={() => void preview(state.id as string)}
            onStartDrag={() => setDraggedStateId(state.id as string)}
            state={state}
            stateCount={states.length}
            workItemCount={stateWorkItemCounts[state.id] ?? 0}
            updateState={updateState}
          />
        ) : null)}
      </ul>

      {previewStateId ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${previewState?.name ?? "state"}?`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded border border-pane-border bg-pane-panel p-5 shadow-xl">
            <h2 className="text-base font-semibold text-text-primary">
              Delete {previewState?.name ?? "state"}?
            </h2>
            {impactLoading ? <p className="mt-2 text-sm text-text-muted">Loading impact…</p> : null}
            {impactError ? (
              <SettingsStatusLine className="mt-3" tone="danger">
                {impactError}
              </SettingsStatusLine>
            ) : null}
            {impactConflict ? (
              <SettingsStatusLine className="mt-3" tone="danger">
                <p>{impactConflict}</p>
                <button
                  type="button"
                  onClick={() => void preview(previewStateId)}
                  className={settingsButtonClass("danger", "mt-2")}
                >
                  Refresh impact
                </button>
              </SettingsStatusLine>
            ) : null}
            {impact ? (
              <div className="mt-2 space-y-3 text-sm text-text-primary">
                <p className="text-text-muted">
                  {impact.total_work_items === 0
                    ? "Nothing is in this state. It will be deleted immediately."
                    : impact.total_work_items === 1
                      ? "1 work item is in this state. Move it somewhere before the state is deleted."
                      : `${impact.total_work_items} work items are in this state. Move them somewhere before the state is deleted.`}
                </p>
                {(impact.protection_rules ?? []).length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4 text-lifecycle-attention">
                    {(impact.protection_rules ?? []).map((rule) => (
                      <li key={rule.code}>{rule.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  previewGeneration.current += 1;
                  setPreviewStateId(null);
                  setImpact(null);
                  setImpactError(null);
                  setImpactConflict(null);
                }}
                className={settingsButtonClass("secondary")}
              >
                Cancel
              </button>
              {impact && !hardBlocked ? (
                <button
                  type="button"
                  onClick={() => void confirmRemoval()}
                  disabled={
                    action !== null
                    || impactConflict !== null
                  }
                  className={settingsButtonClass("danger-filled")}
                >
                  {action === "remove-state" ? "Deleting…" : "Delete state"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {adding ? (
        <div className="mt-3 grid gap-2 rounded border border-dashed border-pane-border p-3">
          <label className="grid gap-1 text-sm text-text-muted">
            State name
            <input
              aria-label="State name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={SETTINGS_FIELD_CLASS}
            />
          </label>
          <label className="grid gap-1 text-sm text-text-muted">
            State group
            <select
              aria-label="State group"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              className={SETTINGS_FIELD_CLASS}
            >
              {STATE_GROUP_ORDER.map((value) => (
                <option key={value} value={value}>{GROUP_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || action !== null}
              className={settingsButtonClass("primary")}
            >
              {action === "create-state" ? "Creating…" : "Create state"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={action !== null}
              className={settingsButtonClass("secondary")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={settingsButtonClass("secondary", "mt-3 block w-full border-dashed text-left")}
        >
          Add state
        </button>
      )}
    </>
  );
}

interface CatalogStateRowProps {
  action: string | null;
  index: number;
  moveState: (stateId: string, offset: -1 | 1) => Promise<void>;
  onDropState: () => void;
  onRemove: () => void;
  onStartDrag: () => void;
  state: State;
  stateCount: number;
  workItemCount: number;
  updateState: (stateId: string, patch: { name?: string; color?: string }) => Promise<void>;
}

function CatalogStateRow({
  action,
  index,
  moveState,
  onDropState,
  onRemove,
  onStartDrag,
  state,
  stateCount,
  updateState,
  workItemCount,
}: CatalogStateRowProps) {
  const stateId = state.id as string;
  const [name, setName] = useState(state.name);

  return (
    <li
      aria-label={`${state.name} state`}
      draggable={action === null}
      onDragStart={onStartDrag}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropState}
      className="group grid cursor-grab gap-2 border-b border-pane-border p-2 active:cursor-grabbing hover:bg-pane-title/50 sm:grid-cols-[auto_minmax(10rem,1fr)_minmax(5.5rem,1fr)_auto_auto] sm:items-center"
    >
      <input
        type="color"
        aria-label={`State color for ${state.name}`}
        value={state.color || "#7a8599"}
        onChange={(event) => void updateState(stateId, { color: event.target.value })}
        className="size-4 cursor-pointer appearance-none rounded-full border border-pane-border bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
      />
      <input
        aria-label={`State name for ${state.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (next && next !== state.name) void updateState(stateId, { name: next });
        }}
        className="min-w-0 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-text-primary outline-none hover:border-pane-border focus:border-focus-accent focus:bg-pane-bg focus:ring-1 focus:ring-focus-accent"
      />
      <span className="text-right text-xs tabular-nums text-text-muted">
        {workItemCount} work {workItemCount === 1 ? "item" : "items"}
      </span>
      <span className="rounded border border-pane-border px-2 py-1 text-sm text-text-secondary">
        {GROUP_LABELS[state.group] ?? state.group}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Move ${state.name} earlier`}
          disabled={action !== null || index === 0}
          onClick={() => void moveState(stateId, -1)}
          className={settingsButtonClass("secondary")}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${state.name} later`}
          disabled={action !== null || index === stateCount - 1}
          onClick={() => void moveState(stateId, 1)}
          className={settingsButtonClass("secondary")}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Delete ${state.name}`}
          onClick={onRemove}
          disabled={action !== null}
          className="grid size-8 place-items-center rounded text-sm text-text-muted opacity-0 transition-opacity hover:bg-lifecycle-danger/10 hover:text-lifecycle-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-accent group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:!opacity-0"
        >
          ×
        </button>
      </div>
    </li>
  );
}

function classifyImpactFailure(error: unknown): {
  conflict: string | null;
  error: string | null;
} {
  const message = apiErrorMessage(error);
  return error instanceof ApiError && error.status === 409
    ? { conflict: message, error: null }
    : { conflict: null, error: message };
}
