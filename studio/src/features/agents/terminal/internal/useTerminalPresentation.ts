import { useEffect, useRef, type RefObject } from "react";

import type { SessionMeta } from "./sessionStore";
import {
  ensureConnected,
  getEntry,
  notifyBackground,
  notifyForeground,
  rememberTerminalGeometry,
} from "./entryPool";

const INITIAL_FIT_ATTEMPTS = 10;
type TerminalEntry = NonNullable<ReturnType<typeof getEntry>>;

type TerminalPresentationOptions = {
  controlledFocus: boolean;
  session: SessionMeta | null;
  sessionId: string | null;
};

/** Attaches one pooled terminal to a host and manages its visible lifecycle. */
export function useTerminalPresentation({
  controlledFocus,
  session,
  sessionId,
}: TerminalPresentationOptions) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountedIdRef = useRef<string | null>(null);
  const fitRafRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!sessionId || !session) {
      host.replaceChildren();
      mountedIdRef.current = null;
      return;
    }

    const entry = getEntry(sessionId);
    if (!entry) return;

    const scheduleFit = createFitScheduler(entry, hostRef, fitRafRef);

    if (mountedIdRef.current !== sessionId) {
      attachTerminal(entry, host, controlledFocus);
      mountedIdRef.current = sessionId;
    }

    fitBeforeConnecting(entry, host);

    ensureConnected(sessionId, session);
    notifyForeground(entry);
    scheduleFit(INITIAL_FIT_ATTEMPTS);

    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleFit();
    });

    const resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(host);

    const handleWheel = createWheelScrollBridge(entry);
    host.addEventListener("wheel", handleWheel, { capture: true, passive: false });

    return () => {
      disposed = true;
      notifyBackground(entry);
      resizeObserver.disconnect();
      host.removeEventListener("wheel", handleWheel, { capture: true });
      if (fitRafRef.current) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = 0;
      }
    };
  }, [controlledFocus, session, sessionId]);

  return { hostRef, mountedIdRef } satisfies {
    hostRef: RefObject<HTMLDivElement>;
    mountedIdRef: RefObject<string | null>;
  };
}

function attachTerminal(entry: TerminalEntry, host: HTMLDivElement, controlledFocus: boolean) {
  host.replaceChildren();
  entry.term.open(host);
  if (!controlledFocus) entry.term.focus?.();
}

function fitBeforeConnecting(entry: TerminalEntry, host: HTMLDivElement) {
  if (host.clientWidth && host.clientHeight) {
    try {
      entry.fit.fit();
      rememberTerminalGeometry(entry.term.cols, entry.term.rows);
    } catch {
      /* A later animation frame retries once xterm is measurable. */
    }
  }
  entry.lastCols = entry.term.cols;
  entry.lastRows = entry.term.rows;
}

function createFitScheduler(
  entry: TerminalEntry,
  hostRef: RefObject<HTMLDivElement>,
  fitRafRef: { current: number },
) {
  const scheduleFit = (attemptsRemaining = 1) => {
    if (fitRafRef.current) return;
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = 0;
      const retry = () => {
        if (attemptsRemaining > 1) scheduleFit(attemptsRemaining - 1);
      };
      const host = hostRef.current;
      if (!host?.clientWidth || !host.clientHeight) {
        retry();
        return;
      }
      try {
        const proposed = entry.fit.proposeDimensions();
        if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
          retry();
          return;
        }
        entry.fit.fit();
        rememberTerminalGeometry(entry.term.cols, entry.term.rows);
      } catch {
        return;
      }

      const { cols, rows } = entry.term;
      if ((cols !== entry.lastCols || rows !== entry.lastRows) && entry.ws) {
        entry.lastCols = cols;
        entry.lastRows = rows;
        try {
          entry.ws.resize(cols, rows);
        } catch {
          /* The socket may close between the visibility check and resize. */
        }
      }
    });
  };
  return scheduleFit;
}

function createWheelScrollBridge(entry: TerminalEntry) {
  return (event: WheelEvent) => {
    if (event.deltaY === 0) return;
    const unit = event.deltaMode === 0 ? 24 : 1;
    const lines = Math.min(20, Math.max(1, Math.round(Math.abs(event.deltaY) / unit)));
    event.preventDefault();
    event.stopPropagation();
    try {
      entry.ws?.scroll(event.deltaY < 0 ? "up" : "down", lines);
    } catch {
      /* The socket may close while handling the wheel event. */
    }
  };
}
