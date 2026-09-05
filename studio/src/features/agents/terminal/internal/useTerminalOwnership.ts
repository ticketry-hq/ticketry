import { useEffect } from "react";

import {
  resolveOwner,
  useTerminalForegroundStore,
  type ForegroundOwner,
} from "./foregroundStore";

/** Claims an explicit terminal surface and follows fallback releases. */
export function useTerminalOwnership(key: string | null, owner: ForegroundOwner) {
  const resolvedOwner = useTerminalForegroundStore((state) =>
    key ? resolveOwner(state, key) : null);
  const acquire = useTerminalForegroundStore((state) => state.acquire);

  useEffect(() => {
    if (!key || owner === "studio") return;
    acquire(key, owner);
    return () => {
      const state = useTerminalForegroundStore.getState();
      if (state.claims[key] === owner) state.release(key);
    };
  }, [acquire, key, owner]);

  useEffect(() => {
    if (!key || owner === "studio") return;
    if (resolvedOwner === "studio") acquire(key, owner);
  }, [acquire, key, owner, resolvedOwner]);

  return {
    acquire,
    resolvedOwner,
  };
}
