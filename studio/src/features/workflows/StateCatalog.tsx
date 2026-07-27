import type { StateImpactOut } from "@worktracker/typescript-sdk";
import { useRef, useState } from "react";
import { ApiError, apiErrorMessage } from "../../shared/api/client";
import type { State } from "../../shared/api/types";
import { STATE_GROUP_ORDER } from "../../shared/utilities/display";
import * as api from "../studio/workflowApi";
import { useWorkflowEditorStore } from "./workflowEditorStore";

const GROUP_LABELS: Record<string, string> = {
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function StateCatalog() {
  const states = useWorkflowEditorStore((state) => state.states);
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
  const [impact, setImpact] = useState<StateImpactOut | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impactConflict, setImpactConflict] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const previewGeneration = useRef(0);

  const submit = async () => {
    const stateName = name.trim();
    if (!stateName) return;
    await createState(stateName, group);
    setName("");
    setAdding(false);
  };

  const preview = async (stateId: string) => {
    const generation = ++previewGeneration.current;
    setPreviewStateId(stateId);
    setImpact(null);
    setImpactError(null);
    setImpactConflict(null);
    setImpactLoading(true);
    try {
      const nextImpact = await api.getStateImpact(stateId);
      if (previewGeneration.current !== generation) return;
      setImpact(nextImpact);
      setReplacementId(nextImpact.valid_replacements?.[0]?.id ?? "");
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
  const hardBlocked = impact?.protection_rules?.some((rule) =>
    rule.code === "protected_state" || rule.code === "last_state_in_group"
  ) ?? false;
  const replacementRequired = impact?.protection_rules?.some(
    (rule) => rule.code === "replacement_required",
  ) ?? false;
  const replacement = impact?.valid_replacements?.find(
    (candidate) => candidate.id === replacementId,
  );

  const confirmRemoval = async () => {
    if (!impact || !previewState || impact.state_id !== previewStateId) return;
    setImpactError(null);
    setImpactConflict(null);
    try {
      await removeState({
        stateId: impact.state_id,
        stateName: previewState.name,
        replacementId: replacementRequired ? replacementId : undefined,
        replacementName: replacementRequired ? replacement?.name : undefined,
        replacement: replacementRequired && replacement
          ? {
              id: replacement.id ?? replacementId,
              name: replacement.name,
              group: replacement.group ?? "",
              color: replacement.color ?? null,
              sort_order: replacement.sort_order,
              is_protected: replacement.is_protected,
            }
          : undefined,
        impactToken: impact.impact_token,
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
            updateState={updateState}
          />
        ) : null)}
      </ul>

      {previewStateId ? (
        <section
          aria-label="State replacement impact"
          className="mt-3 rounded border border-amber-500/50 bg-amber-950/20 p-3 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-amber-200">
              Remove {previewState?.name ?? "state"}
            </h3>
            <button
              type="button"
              onClick={() => {
                previewGeneration.current += 1;
                setPreviewStateId(null);
                setImpact(null);
                setImpactError(null);
                setImpactConflict(null);
              }}
              className="text-text-muted hover:text-text-primary"
            >
              Close
            </button>
          </div>
          {impactLoading ? <p className="mt-2 text-text-muted">Loading impact…</p> : null}
          {impactError ? <p role="alert" className="mt-2 text-red-200">{impactError}</p> : null}
          {impactConflict ? (
            <div role="alert" className="mt-2 rounded border border-red-500/50 p-2 text-red-200">
              <p>{impactConflict}</p>
              <button
                type="button"
                onClick={() => void preview(previewStateId)}
                className="mt-2 rounded border border-red-300 px-2 py-1"
              >
                Refresh impact
              </button>
            </div>
          ) : null}
          {impact ? (
            <div className="mt-3 space-y-3 text-text-primary">
              <p>
                {impact.total_work_items} affected work {impact.total_work_items === 1 ? "item" : "items"}
              </p>
              {(impact.protection_rules ?? []).length > 0 ? (
                <ul className="list-disc space-y-1 pl-4 text-amber-200">
                  {(impact.protection_rules ?? []).map((rule) => (
                    <li key={rule.code}>{rule.message}</li>
                  ))}
                </ul>
              ) : null}
              {replacementRequired && !hardBlocked ? (
                <>
                  <label className="grid gap-1 text-text-muted">
                    Replacement state
                    <select
                      aria-label="Replacement state"
                      value={replacementId}
                      onChange={(event) => setReplacementId(event.target.value)}
                      className="rounded border border-pane-border bg-pane-panel px-2 py-1.5 text-text-primary"
                    >
                      {(impact.valid_replacements ?? []).map((candidate) =>
                        candidate.id ? (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ) : null)}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Replace ${previewState?.name ?? "state"} with ${replacement?.name ?? "selected state"}`}
                    onClick={() => void confirmRemoval()}
                    disabled={!replacementId || action !== null || impactConflict !== null}
                    className="rounded border border-amber-400 px-2 py-1.5 text-amber-200 disabled:opacity-50"
                  >
                    {action === "remove-state" ? "Replacing…" : "Confirm replacement"}
                  </button>
                </>
              ) : null}
              {!replacementRequired && !hardBlocked ? (
                <button
                  type="button"
                  aria-label={`Delete ${previewState?.name ?? "state"}`}
                  onClick={() => void confirmRemoval()}
                  disabled={action !== null || impactConflict !== null}
                  className="rounded border border-red-400 px-2 py-1.5 text-red-200 disabled:opacity-50"
                >
                  {action === "remove-state" ? "Deleting…" : "Confirm deletion"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {adding ? (
        <div className="mt-3 grid gap-2 rounded border border-dashed border-pane-border p-3">
          <label className="grid gap-1 text-xs text-text-muted">
            State name
            <input
              aria-label="State name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded border border-pane-border bg-pane-panel px-2 py-1.5 text-sm text-text-primary"
            />
          </label>
          <label className="grid gap-1 text-xs text-text-muted">
            State group
            <select
              aria-label="State group"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              className="rounded border border-pane-border bg-pane-panel px-2 py-1.5 text-sm text-text-primary"
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
              className="rounded border border-focus-accent px-2 py-1.5 text-xs text-focus-accent disabled:opacity-50"
            >
              {action === "create-state" ? "Creating…" : "Create state"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={action !== null}
              className="rounded border border-pane-border px-2 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 block w-full rounded border border-dashed border-pane-border px-3 py-2 text-left text-sm text-text-muted hover:border-focus-accent hover:text-focus-accent"
        >
          + Add State
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
}: CatalogStateRowProps) {
  const stateId = state.id as string;
  const [name, setName] = useState(state.name);

  return (
    <li
      draggable={action === null}
      onDragStart={onStartDrag}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropState}
      className="grid cursor-grab gap-2 rounded border border-pane-border bg-pane-panel p-2 active:cursor-grabbing sm:grid-cols-[minmax(10rem,1fr)_auto_auto_auto] sm:items-center"
    >
      <input
        aria-label={`State name for ${state.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (next && next !== state.name) void updateState(stateId, { name: next });
        }}
        className="min-w-0 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-text-primary focus:border-pane-border"
      />
      <span className="rounded bg-pane-title px-2 py-1 text-xs text-text-secondary">
        {GROUP_LABELS[state.group] ?? state.group}
      </span>
      <input
        type="color"
        aria-label={`State color for ${state.name}`}
        value={state.color || "#7a8599"}
        onChange={(event) => void updateState(stateId, { color: event.target.value })}
        className="h-8 w-10 rounded border border-pane-border bg-pane-bg p-1"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Move ${state.name} earlier`}
          disabled={action !== null || index === 0}
          onClick={() => void moveState(stateId, -1)}
          className="rounded px-1.5 py-1 text-text-muted disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${state.name} later`}
          disabled={action !== null || index === stateCount - 1}
          onClick={() => void moveState(stateId, 1)}
          className="rounded px-1.5 py-1 text-text-muted disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Review impact for ${state.name}`}
          onClick={onRemove}
          disabled={action !== null}
          className="rounded px-1.5 py-1 text-xs text-amber-300 disabled:opacity-40"
        >
          Remove
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
