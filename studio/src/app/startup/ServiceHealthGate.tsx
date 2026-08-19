import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  studioRuntime,
  type ServiceHealth,
  type StudioRuntime,
} from "../../runtime";
import { reloadStudio } from "./reloadStudio";

export function ServiceHealthGate({
  children,
  runtime = studioRuntime(),
  reload = reloadStudio,
}: {
  children: ReactNode;
  runtime?: StudioRuntime;
  reload?: () => void;
}) {
  const initialHealth = runtime.startup().serviceHealth;
  const [health, setHealth] = useState(initialHealth);
  const [retrying, setRetrying] = useState(false);
  const retryInFlight = useRef(false);
  const recoveryObserved = useRef(initialHealth.state === "recovering");

  useEffect(() =>
    runtime.subscribeServiceHealth((nextHealth: ServiceHealth) => {
      setHealth(nextHealth);
      if (nextHealth.state === "recovering") {
        recoveryObserved.current = true;
        return;
      }
      if (nextHealth.state !== "ready") return;

      if (recoveryObserved.current) {
        recoveryObserved.current = false;
        reload();
      }
    }), [reload, runtime]);

  if (health.state === "failed") {
    const retry = async () => {
      if (retryInFlight.current) return;
      retryInFlight.current = true;
      setRetrying(true);
      try {
        await runtime.retryServices();
      } catch {
        // The shell publishes the actionable failed health before rejecting.
      } finally {
        retryInFlight.current = false;
        setRetrying(false);
      }
    };

    return (
      <div className="flex h-full w-full items-center justify-center bg-pane-bg p-8">
        <div className="max-w-xl text-center">
          <h1 className="text-lg font-semibold text-text-primary">
            Ticketry services could not start
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {health.message ?? "The local server stopped unexpectedly."}
          </p>
          {health.logPointer && (
            <p className="mt-2 text-sm text-text-muted">
              Sidecar log:{" "}
              <span className="font-mono text-text-primary">
                {health.logPointer}
              </span>
            </p>
          )}
          <button
            type="button"
            disabled={retrying}
            onClick={() => void retry()}
            className="mt-5 bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  if (health.state !== "recovering") return <>{children}</>;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full w-full items-center justify-center bg-pane-bg p-8"
    >
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-text-primary">
          Reconnecting to the local server
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Studio will refresh when the local server is ready.
        </p>
      </div>
    </div>
  );
}
