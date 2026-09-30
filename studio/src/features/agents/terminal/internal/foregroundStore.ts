import { createApolloStore } from "../../../../shared/apollo/localState";
import type { SessionMeta } from "./sessionStore";

// `panel` is the bottom terminal panel (#667). Claims are keyed by run, and a
// shell run is never an agent run, so a shell and an agent terminal can be
// presented at the same time without competing for the same claim.
export type ForegroundOwner = "studio" | "drawer" | "panel";

interface ForegroundClaimsState {
  claims: Record<string, ForegroundOwner>;
  acquire: (key: string, owner: ForegroundOwner) => void;
  release: (key: string) => void;
  releaseOwner: (owner: ForegroundOwner) => void;
  rekey: (oldKey: string, newKey: string) => void;
}

interface TerminalForegroundRegistry extends ForegroundClaimsState {
  hostTargets: Partial<Record<ForegroundOwner, HTMLElement | null>>;
  registerHost: (owner: ForegroundOwner, el: HTMLElement | null) => void;
  unregisterHost: (owner: ForegroundOwner) => void;
}

const useForegroundClaims = createApolloStore<ForegroundClaimsState>(
  "terminal-foreground-claims",
  (set) => ({
    claims: {},
    acquire(key, owner) {
      set((state) => {
        if (owner === "studio") {
          if (!(key in state.claims)) return state;
          const claims = { ...state.claims };
          delete claims[key];
          return { claims };
        }
        if (state.claims[key] === owner) return state;
        return { claims: { ...state.claims, [key]: owner } };
      });
    },
    release(key) {
      set((state) => {
        if (!(key in state.claims)) return state;
        const claims = { ...state.claims };
        delete claims[key];
        return { claims };
      });
    },
    releaseOwner(owner) {
      set((state) => {
        const claims = Object.fromEntries(
          Object.entries(state.claims).filter(([, value]) => value !== owner),
        );
        return Object.keys(claims).length === Object.keys(state.claims).length
          ? state
          : { claims };
      });
    },
    rekey(oldKey, newKey) {
      set((state) => {
        if (oldKey === newKey || state.claims[oldKey] === undefined) return state;
        const claims = { ...state.claims };
        const owner = claims[oldKey];
        delete claims[oldKey];
        claims[newKey] = owner;
        return { claims };
      });
    },
  }),
);

// DOM nodes are runtime handles. They never enter Apollo's serializable state.
let hostTargets: TerminalForegroundRegistry["hostTargets"] = {};

const hostActions = {
  registerHost(owner: ForegroundOwner, el: HTMLElement | null) {
    hostTargets = { ...hostTargets, [owner]: el };
  },
  unregisterHost(owner: ForegroundOwner) {
    if (!(owner in hostTargets)) return;
    const next = { ...hostTargets };
    delete next[owner];
    hostTargets = next;
  },
};

function registry(state = useForegroundClaims.getState()): TerminalForegroundRegistry {
  return { ...state, ...hostActions, hostTargets };
}

function useRegistry<T>(selector: (state: TerminalForegroundRegistry) => T): T {
  return useForegroundClaims((state) => selector(registry(state)));
}

export const useTerminalForegroundStore = Object.assign(useRegistry, {
  getState: registry,
  setState: (next: Partial<TerminalForegroundRegistry>) => {
    if (next.hostTargets) hostTargets = next.hostTargets;
    if (next.claims) useForegroundClaims.setState({ claims: next.claims });
  },
  subscribe: useForegroundClaims.subscribe,
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
