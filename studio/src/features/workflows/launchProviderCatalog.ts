import { useMemo } from "react";
import { useProviderCapabilitiesQuery } from "./providerQueries";

// The Query-owned provider-capabilities payload (ADR-0015).
// The server already omits deactivated providers from it, so every launch
// surface that filters against this cache shows the same set the server will
// accept — activation can never be enforced on the client alone.
//
// Deliberately separate from the workflow editor: the agent picker and
// the work-item launcher menu need the activation set without dragging the
// whole workflow editor into their chunk.

export interface ActivatedProviders {
  /** Slugs the server still offers — everything else is deactivated. */
  slugs: Set<string>;
  /** False until the payload has been read at least once. */
  loaded: boolean;
  /** True when the last attempt failed — an empty list is an error, not an answer. */
  failed: boolean;
}

/** Read (and lazily load) the activated provider slugs for a launch surface. */
export function useActivatedProviders(): ActivatedProviders {
  const query = useProviderCapabilitiesQuery();
  const capabilities = query.data ?? [];
  const loaded = query.data !== undefined;
  const failed = query.isError;
  return useMemo(
    () => ({
      slugs: new Set(capabilities.map((capability) => capability.agent)),
      loaded,
      failed,
    }),
    [capabilities, failed, loaded],
  );
}

/**
 * What a launch surface should say instead of rendering an empty provider list.
 * The three reasons a list can be empty are not interchangeable: not loaded
 * yet, a fetch that keeps failing, and nothing actually activated.
 */
export function providerListPlaceholder(
  { loaded, failed }: Pick<ActivatedProviders, "failed" | "loaded">,
): string {
  if (failed) return "Providers unavailable — retry.";
  if (!loaded) return "Loading providers…";
  return "No activated providers. Activate one in Settings → Model configuration.";
}
