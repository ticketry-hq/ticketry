import { useSyncExternalStore } from "react";
import type { SessionMeta } from "./sessionStore";

// `panel` is the bottom terminal panel (#667). Claims are keyed by run, and a
// shell run is never an agent run, so a shell and an agent terminal can be
// presented at the same time without competing for the same claim.
export type ForegroundOwner = "studio" | "drawer" | "panel";

interface TerminalForegroundRegistry {
  claims: Record<string, ForegroundOwner>;
  hostTargets: Partial<Record<ForegroundOwner, HTMLElement | null>>;
  acquire: (key: string, owner: ForegroundOwner) => void;
  release: (key: string) => void;
  releaseOwner: (owner: ForegroundOwner) => void;
  rekey: (oldKey: string, newKey: string) => void;
  registerHost: (owner: ForegroundOwner, el: HTMLElement | null) => void;
  unregisterHost: (owner: ForegroundOwner) => void;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let claims: Record<string, ForegroundOwner> = {};
let hostTargets: Partial<Record<ForegroundOwner, HTMLElement | null>> = {};

function publish(): void {
  snapshot = { ...actions, claims, hostTargets };
  for (const listener of listeners) listener();
}

const actions = {
  acquire(key: string, owner: ForegroundOwner) {
    if (owner === "studio") {
      actions.release(key);
      return;
    }
    if (claims[key] === owner) return;
    claims = { ...claims, [key]: owner };
    publish();
  },
  release(key: string) {
    if (!(key in claims)) return;
    const next = { ...claims };
    delete next[key];
    claims = next;
    publish();
  },
  releaseOwner(owner: ForegroundOwner) {
    const next = Object.fromEntries(
      Object.entries(claims).filter(([, value]) => value !== owner),
    );
    if (Object.keys(next).length === Object.keys(claims).length) return;
    claims = next;
    publish();
  },
  rekey(oldKey: string, newKey: string) {
    if (oldKey === newKey || claims[oldKey] === undefined) return;
    const next = { ...claims };
    const owner = next[oldKey];
    delete next[oldKey];
    next[newKey] = owner;
    claims = next;
    publish();
  },
  registerHost(owner: ForegroundOwner, el: HTMLElement | null) {
    hostTargets = { ...hostTargets, [owner]: el };
    publish();
  },
  unregisterHost(owner: ForegroundOwner) {
    if (!(owner in hostTargets)) return;
    const next = { ...hostTargets };
    delete next[owner];
    hostTargets = next;
    publish();
  },
};

let snapshot: TerminalForegroundRegistry = { ...actions, claims, hostTargets };

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useRegistry<T>(selector: (state: TerminalForegroundRegistry) => T): T {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return selector(state);
}

export const useTerminalForegroundStore = Object.assign(useRegistry, {
  getState: () => snapshot,
  setState: (next: Partial<TerminalForegroundRegistry>) => {
    if (next.claims) claims = next.claims;
    if (next.hostTargets) hostTargets = next.hostTargets;
    publish();
  },
  subscribe,
});

export function foregroundKey(
  meta: Pick<SessionMeta, "agentRunId" | "sessionId">,
): string {
  return meta.agentRunId ?? meta.sessionId;
}

export function resolveOwner(
  state: Pick<TerminalForegroundRegistry, "claims">,
  key: string,
): ForegroundOwner {
  return state.claims[key] ?? "studio";
}

export function isStudioEligible(
  state: Pick<TerminalForegroundRegistry, "claims">,
  meta: Pick<SessionMeta, "agentRunId" | "sessionId">,
): boolean {
  return resolveOwner(state, foregroundKey(meta)) === "studio";
}
