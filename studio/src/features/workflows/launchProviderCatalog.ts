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
}

export const useLaunchProviderCatalog = create<LaunchProviderCatalogState>(() => ({
  capabilities: [],
  loaded: false,
}));

let inFlight: Promise<ProviderCapabilities[]> | null = null;

/** Refetch the payload and publish it to every mirror. Rejects on failure. */
export function fetchLaunchProviderCatalog(): Promise<ProviderCapabilities[]> {
  if (inFlight) return inFlight;
  inFlight = api
    .getLaunchProviderCapabilities()
    .then((capabilities) => {
      useLaunchProviderCatalog.setState({ capabilities, loaded: true });
      return capabilities;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Fetch once for surfaces that only read; a failure leaves the last payload. */
export function ensureLaunchProviderCatalog(): void {
  if (useLaunchProviderCatalog.getState().loaded || inFlight) return;
  void fetchLaunchProviderCatalog().catch(() => {});
}

export interface ActivatedProviders {
  /** Slugs the server still offers — everything else is deactivated. */
  slugs: Set<string>;
  /** False until the payload has been read at least once. */
  loaded: boolean;
}

/** Read (and lazily load) the activated provider slugs for a launch surface. */
export function useActivatedProviders(): ActivatedProviders {
  const capabilities = useLaunchProviderCatalog((state) => state.capabilities);
  const loaded = useLaunchProviderCatalog((state) => state.loaded);
  useEffect(() => {
    ensureLaunchProviderCatalog();
  }, []);
  return useMemo(
    () => ({
      slugs: new Set(capabilities.map((capability) => capability.agent)),
      loaded,
    }),
    [capabilities, loaded],
  );
}
