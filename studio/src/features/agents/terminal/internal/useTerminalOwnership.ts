import { useEffect } from "react";

import {
  resolveOwner,
  useTerminalForegroundStore,
  type ForegroundOwner,
} from "./foregroundStore";

/** Claims an explicit terminal surface and follows fallback releases. */
export function useTerminalOwnership(key: string | null, owner: ForegroundOwner) {
  const claims = useTerminalForegroundStore((state) => state.claims);
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
    if (resolveOwner({ claims }, key) === "studio") acquire(key, owner);
  }, [acquire, claims, key, owner]);

  return {
    acquire,
    resolvedOwner: key ? resolveOwner({ claims }, key) : null,
  };
}
