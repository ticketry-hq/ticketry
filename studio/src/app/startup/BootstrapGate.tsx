import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bootstrapStudio, type BootstrapOutcome } from "./bootstrapStudio";
import { SettingsAccess } from "./SettingsAccess";

type BootstrapStatus = "connecting" | BootstrapOutcome;
type ConnectingStatus = Exclude<BootstrapStatus, "ready">;

// The backend may briefly have no profile while local provisioning finishes.
const RETRY_POLL_MS = 2000;
const STATUS_MESSAGES: Record<ConnectingStatus, string> = {
  connecting: "One moment…",
  provisioning: "The local work tracker is still starting up. Retrying…",
  unavailable: "The local server is not running.",
};

export function BootstrapGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BootstrapStatus>("connecting");
  const latestAttempt = useRef(0);

  const attemptBootstrap = useCallback(() => {
    const attempt = ++latestAttempt.current;
    setStatus("connecting");

    void bootstrapStudio().then((outcome) => {
      if (attempt === latestAttempt.current) setStatus(outcome);
    });
  }, []);

  useEffect(() => {
    attemptBootstrap();
    return () => {
      latestAttempt.current += 1;
    };
  }, [attemptBootstrap]);

  useEffect(() => {
    if (status === "connecting" || status === "ready") return;

    const timer = setTimeout(attemptBootstrap, RETRY_POLL_MS);
    return () => clearTimeout(timer);
  }, [attemptBootstrap, status]);

  if (status === "ready") return <>{children}</>;

  return <ConnectingScreen status={status} onRetry={attemptBootstrap} />;
}

interface ConnectingScreenProps {
  status: ConnectingStatus;
  onRetry: () => void;
}

function ConnectingScreen({ status, onRetry }: ConnectingScreenProps) {
  const isWaiting = status === "connecting";

  return (
    <div className="flex h-full w-full items-center justify-center bg-pane-bg">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="text-text-primary">
          Connecting to local work tracker…
        </div>
        <div className="text-sm text-text-muted">{STATUS_MESSAGES[status]}</div>
        {status === "unavailable" ? (
          <div className="text-sm text-text-muted">
            Start the local server, then retry. Retrying…
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          {isWaiting ? null : (
            <button
              type="button"
              onClick={onRetry}
              className="border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent hover:bg-pane-bg"
            >
              Retry
            </button>
          )}
          {/* Settings is otherwise unreachable while this gate owns the screen. */}
          <SettingsAccess />
        </div>
      </div>
    </div>
  );
}
