import { useRef, useState } from "react";
import { createWorkItem } from "../../work-items";
import { convergePlanningCollections, type CreationType } from "../../planning-graph";
import { studioApolloClient } from "../../../shared/apollo/client";

type EntryState = { kind: "closed" } | { kind: "editing"; error: string | null } | { kind: "creating" } | { kind: "refreshFailed"; id: string; error: string };
export interface EpicEntryProps { projectId: string; epicType: CreationType; onCreated: (id: string) => void }

export function useEpicEntry({ projectId, epicType, onCreated }: EpicEntryProps) {
  const [state, setState] = useState<EntryState>({ kind: "closed" });
  const [name, setName] = useState("");
  const pending = useRef(false);
  const close = () => { if (!pending.current) { setName(""); setState({ kind: "closed" }); } };
  async function refresh(id: string) {
    try {
      await convergePlanningCollections(studioApolloClient(), [projectId]);
      onCreated(id);
      setName(""); setState({ kind: "closed" });
    } catch (cause) {
      setState({ kind: "refreshFailed", id, error: `Epic created. The view could not refresh: ${cause instanceof Error ? cause.message : "Try refreshing again."}` });
    }
  }
  async function submit() {
    if (pending.current) return;
    if (state.kind === "refreshFailed") {
      pending.current = true;
      try { await refresh(state.id); } finally { pending.current = false; }
      return;
    }
    if (state.kind !== "editing" || !name.trim()) return;
    if ("error" in epicType) { setState({ kind: "editing", error: epicType.error }); return; }
    pending.current = true; setState({ kind: "creating" });
    try {
      const epic = await createWorkItem(projectId, { name: name.trim(), issue_type_id: epicType.id, parent_id: null });
      await refresh(epic.id);
    } catch (cause) {
      setState({ kind: "editing", error: cause instanceof Error ? cause.message : "Could not create epic." });
    } finally { pending.current = false; }
  }
  return { state, name, setName, open: () => setState({ kind: "editing", error: null }), close, submit };
}
