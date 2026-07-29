import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { ProviderCapabilities } from "../../shared/api/types";
import * as api from "../studio/workflowApi";

// The one client-side mirror of the provider-capabilities payload (ADR-0015).
// The server already omits deactivated providers from it, so every launch
// surface that filters against this store shows the same set the server will
// accept — activation can never be enforced on the client alone.
//
// Deliberately separate from the workflow editor store: the agent picker and
// the work-item launcher menu need the activation set without dragging the
// whole workflow editor into their chunk.

interface LaunchProviderCatalogState {
  capabilities: ProviderCapabilities[];
  loaded: boolean;
  /** True once a fetch failed and none has succeeded since. */
  failed: boolean;
}

export const useLaunchProviderCatalog = create<LaunchProviderCatalogState>(() => ({
  capabilities: [],
  loaded: false,
  failed: false,
}));

let inFlight: Promise<ProviderCapabilities[]> | null = null;

/** Refetch the payload and publish it to every mirror. Rejects on failure.
 *
 * Coalescing concurrent fetches is right for read-only callers and wrong for a
 * refresh-after-write: a GET that started before the PUT committed would be
 * handed back as-is, so the post-save refresh would publish the *pre-save*
 * payload as authoritative. A writer passes `force` to skip the coalescing.
 */
export function fetchLaunchProviderCatalog(
  { force = false }: { force?: boolean } = {},
): Promise<ProviderCapabilities[]> {
  if (inFlight && !force) return inFlight;
  // Cleared by identity, so a stale request settling after a forced one does
  // not drop the forced request's slot.
  const request: Promise<ProviderCapabilities[]> = api
    .getLaunchProviderCapabilities()
    .then((capabilities) => {
      useLaunchProviderCatalog.setState({
        capabilities,
        loaded: true,
        failed: false,
      });
      return capabilities;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/** Fetch once for surfaces that only read; a failure leaves the last payload. */
export function ensureLaunchProviderCatalog(): void {
  if (useLaunchProviderCatalog.getState().loaded || inFlight) return;
  void fetchLaunchProviderCatalog().catch(() => {
    useLaunchProviderCatalog.setState({ failed: true });
  });
}

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
  const capabilities = useLaunchProviderCatalog((state) => state.capabilities);
  const loaded = useLaunchProviderCatalog((state) => state.loaded);
  const failed = useLaunchProviderCatalog((state) => state.failed);
  useEffect(() => {
    ensureLaunchProviderCatalog();
  }, []);
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
