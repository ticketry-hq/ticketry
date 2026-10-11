import { useEffect, useRef } from "react";
import type { CreationType } from "../../planning-graph";
import { useStoryCreation } from "../../work-items";
import type { StoryCreationSlot, StoryCreationState } from "./storyCreationEntries";

export type InlineStoryCreationProps = {
  projectId: string;
  epicId: string | null;
  sprintId: string | null;
  storyType: CreationType;
  disabled: boolean;
  slot: StoryCreationSlot;
};

export default function InlineStoryCreation({ projectId, epicId, sprintId, storyType, disabled, slot }: InlineStoryCreationProps) {
  const { createWorkItem, assignStory, refreshGraph } = useStoryCreation(projectId);
  const { entry: { state, name }, patch, inFlight } = slot;
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const wasBusy = useRef(false);
  const busy = state.kind === "busy";
  useEffect(() => {
    if (wasBusy.current && !busy && (document.activeElement === document.body || container.current?.contains(document.activeElement))) {
      input.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);
  const run = async (action: () => Promise<StoryCreationState | "done">) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    patch({ state: { kind: "busy" } });
    try {
      const next = await action();
      patch(next === "done" ? { state: { kind: "editing", error: null }, name: "" } : { state: next });
    } finally { inFlight.current = false; }
  };
  const refresh = async (): Promise<StoryCreationState | "done"> => {
    const outcome = await refreshGraph();
    return outcome.kind === "ok" ? "done" : { kind: "refreshFailed", message: `Story saved, but the view could not refresh: ${outcome.message}` };
  };
  const assign = async (id: string, into: string): Promise<StoryCreationState | "done"> => {
    const outcome = await assignStory(id, into);
    if (outcome.kind === "assigned") return refresh();
    const refreshed = await refreshGraph();
    return { kind: "assignFailed", id, sprintId: into,
      message: `Story created; sprint assignment failed: ${outcome.message}${refreshed.kind === "failed" ? ` The backlog could not refresh: ${refreshed.message}` : ""}` };
  };
  const inspect = async (): Promise<StoryCreationState> => {
    const outcome = await refreshGraph();
    return { kind: "unknown", message: `Could not confirm whether the story was created. Check the backlog before adding it again.${outcome.kind === "failed" ? ` The backlog could not refresh: ${outcome.message}` : ""}` };
  };
  const close = () => {
    if (inFlight.current) return;
    patch({ state: { kind: "closed" }, name: "" });
    requestAnimationFrame(() => container.current?.querySelector("button")?.focus());
  };
  const submit = async () => {
    if (disabled || inFlight.current) return;
    if (state.kind === "assignFailed") { await run(() => assign(state.id, state.sprintId)); return; }
    if (state.kind === "refreshFailed") { await run(refresh); return; }
    if (state.kind !== "editing" || !name.trim()) return;
    if ("error" in storyType) { patch({ state: { kind: "editing", error: storyType.error } }); return; }
    await run(async () => {
      const created = await createWorkItem({ name: name.trim(), issueTypeId: storyType.id, epicId });
      if (created.kind !== "created") {
        return created.kind === "rejected" ? { kind: "editing", error: created.message } : inspect();
      }
      return sprintId ? assign(created.id, sprintId) : refresh();
    });
  };
  const message = state.kind === "editing" ? state.error : "message" in state ? state.message : null;
  return <div ref={container} aria-busy={busy} className="px-3 py-1">
    {state.kind === "closed" ? <button type="button" aria-label="Add story" disabled={disabled}
      onClick={() => patch({ state: { kind: "editing", error: null } })}
      className="text-xs text-focus-accent disabled:opacity-40">+ Add story</button> : <>
      <input ref={input} autoFocus aria-label="Story title" value={name} disabled={disabled || busy} readOnly={state.kind !== "editing"}
        onChange={(event) => patch({ name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void submit(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        }}
        className="h-7 w-full border border-dashed border-pane-border bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent disabled:opacity-40"
        placeholder="Story title" />
      {message && <p role="alert" className="pt-1 text-xs text-lifecycle-danger">{message}</p>}
      {state.kind === "assignFailed" && <button type="button" disabled={disabled}
        onClick={() => { void run(() => assign(state.id, state.sprintId)); }}
        className="pt-1 text-xs text-focus-accent underline disabled:opacity-40">Retry assignment</button>}
      {state.kind === "refreshFailed" && <button type="button" disabled={disabled}
        onClick={() => { void run(refresh); }}
        className="pt-1 text-xs text-focus-accent underline disabled:opacity-40">Retry refresh</button>}
      {state.kind === "unknown" && <button type="button" disabled={disabled}
        onClick={() => { void run(inspect); }}
        className="pt-1 text-xs text-focus-accent underline disabled:opacity-40">Inspect backlog</button>}
      {(state.kind === "unknown" || state.kind === "assignFailed" || state.kind === "refreshFailed") && <button type="button"
        onClick={close} className="ml-3 pt-1 text-xs text-text-secondary underline">Dismiss</button>}
    </>}
  </div>;
}
