import { useEffect, useId, useRef } from "react";
import { createApolloStore } from "../../../shared/apollo/localState";

export type StoryCreationState =
  | { kind: "closed" }
  | { kind: "editing"; error: string | null }
  | { kind: "busy" }
  | { kind: "unknown"; message: string }
  | { kind: "assignFailed"; id: string; sprintId: string; message: string }
  | { kind: "refreshFailed"; message: string };

type StoryCreationEntry = { state: StoryCreationState; name: string };
export type StoryCreationSlot = {
  entry: StoryCreationEntry;
  patch: (change: Partial<StoryCreationEntry>) => void;
  inFlight: { current: boolean };
};

const BLANK: StoryCreationEntry = { state: { kind: "closed" }, name: "" };
const useEntries = createApolloStore<{ entries: Record<string, StoryCreationEntry> }>(
  "plan-story-entries", () => ({ entries: {} }),
);

export function useStoryCreationEntries(generation: number) {
  const visitId = useId();
  useEntries.getState();
  const entries = useEntries((state) => state.entries);
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  const currentGeneration = useRef(generation);
  currentGeneration.current = generation;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      useEntries.setState(({ entries: current }) => ({
        entries: Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${visitId}:${generation}:`))),
      }));
    };
  }, [visitId, generation]);
  return (epicId: string, sprintId: string | null): StoryCreationSlot => {
    const key = `${visitId}:${generation}:${JSON.stringify([epicId, sprintId])}`;
    return {
      entry: entries[key] ?? BLANK,
      patch: (change) => {
        if (mounted.current && currentGeneration.current === generation) useEntries.setState(({ entries: current }) => ({
          entries: { ...current, [key]: { ...(current[key] ?? BLANK), ...change } },
        }));
      },
      inFlight: {
        get current() { return pending.current.has(key); },
        set current(held) { if (held) pending.current.add(key); else pending.current.delete(key); },
      },
    };
  };
}
