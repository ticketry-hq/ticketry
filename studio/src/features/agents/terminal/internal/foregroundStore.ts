import { create } from "zustand";
import type { SessionMeta } from "./sessionStore";

// CODIN-749 — single-owner terminal foreground registry.
//
// Deliberately session-agnostic: it stores foreground *claims* and mount
// *targets*, never session metadata. Session identity + lifecycle stay owned by
// terminalStore; the xterm/WS objects stay owned by the shared terminal layer.
// This store is the thin policy layer that
// decides which surface — the fallback workspace or issue drawer — may present
// a given live session at any instant, so a session can
// only ever have one foreground xterm DOM owner.

// The surfaces that can present a terminal. `studio` is the implicit default;
// `drawer` (issue drawer) is an explicit claim. Absence of any live session for
// a key is the implicit "no foreground owner / backgrounded" state, expressed
// as a `null`-equivalent resolution (fallback to `studio`) rather than a stored value.
export type ForegroundOwner = "studio" | "drawer";

interface TerminalForegroundState {
  // Foreground key -> the owner currently claiming it. Only non-default
  // (`drawer`) claims are recorded; `studio` is the implicit
  // fallback, so an unclaimed live session is studio-eligible without any write.
  claims: Record<string, ForegroundOwner>;
  // Per-owner registered mount-target element. Workspace hosts register
  // Kept so a host can attach the *same* shared Terminal — never spawn a second.
  hostTargets: Partial<Record<ForegroundOwner, HTMLElement | null>>;

  // Adapter API called by terminal-presenting surfaces.
  acquire: (key: string, owner: ForegroundOwner) => void;
  release: (key: string) => void;
  releaseOwner: (owner: ForegroundOwner) => void;
  rekey: (oldKey: string, newKey: string) => void;
  registerHost: (owner: ForegroundOwner, el: HTMLElement | null) => void;
  unregisterHost: (owner: ForegroundOwner) => void;
}

export const useTerminalForegroundStore = create<TerminalForegroundState>(
  (set) => ({
    claims: {},
    hostTargets: {},

    acquire(key, owner) {
      // `studio` is the implicit default, so claiming it for a key is exactly
      // releasing that key. Kept as a symmetric no-op for testability.
      if (owner === "studio") {
        set((s) => {
          if (!(key in s.claims)) return s;
          const claims = { ...s.claims };
          delete claims[key];
          return { claims };
        });
        return;
      }
      set((s) => {
        if (s.claims[key] === owner) return s;
        return { claims: { ...s.claims, [key]: owner } };
      });
    },

    release(key) {
      set((s) => {
        if (!(key in s.claims)) return s;
        const claims = { ...s.claims };
        delete claims[key];
        return { claims };
      });
    },

    releaseOwner(owner) {
      set((s) => {
        const claims = Object.fromEntries(
          Object.entries(s.claims).filter(([, v]) => v !== owner),
        );
        if (Object.keys(claims).length === Object.keys(s.claims).length) {
          return s;
        }
        return { claims };
      });
    },

    rekey(oldKey, newKey) {
      if (oldKey === newKey) return;
      set((s) => {
        const owner = s.claims[oldKey];
        if (owner === undefined) return s;
        const claims = { ...s.claims };
        delete claims[oldKey];
        claims[newKey] = owner;
        return { claims };
      });
    },

    registerHost(owner, el) {
      set((s) => ({ hostTargets: { ...s.hostTargets, [owner]: el } }));
    },

    unregisterHost(owner) {
      set((s) => {
        if (!(owner in s.hostTargets)) return s;
        const hostTargets = { ...s.hostTargets };
        delete hostTargets[owner];
        return { hostTargets };
      });
    },
  }),
);

// ---- Pure helpers (the single source of truth for "who owns this key") ----

// A session's durable foreground key: its run identity when known, else its
// live session id. Every host derives the key from the same
// SessionMeta, so they always agree on the key for a given live run.
export function foregroundKey(meta: Pick<SessionMeta, "agentRunId" | "sessionId">): string {
  return meta.agentRunId ?? meta.sessionId;
}

// Who owns a key right now — an explicit `drawer` claim, else
// the `studio` default.
export function resolveOwner(
  state: Pick<TerminalForegroundState, "claims">,
  key: string,
): ForegroundOwner {
  return state.claims[key] ?? "studio";
}

// Whether the fallback host may attach a session's xterm DOM. False exactly when
// another surface (the drawer) holds the session's
// foreground key.
export function isStudioEligible(
  state: Pick<TerminalForegroundState, "claims">,
  meta: Pick<SessionMeta, "agentRunId" | "sessionId">,
): boolean {
  return resolveOwner(state, foregroundKey(meta)) === "studio";
}
