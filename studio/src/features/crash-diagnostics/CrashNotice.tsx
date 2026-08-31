import { useEffect, useState } from "react";

import { studioRuntime } from "../../runtime";
import {
  crashNoticeWasDismissed,
  dismissCrashNotice,
} from "./crashNoticeSession";

export function CrashNotice() {
  const [visible, setVisible] = useState(false);
  const [runtime] = useState(() => studioRuntime());
  const runtimeInstance = runtime.startup().runtimeInstance;

  useEffect(() => {
    if (crashNoticeWasDismissed(runtimeInstance)) return;
    let active = true;
    const crashReports = runtime.crashReports;
    if (!crashReports) return;
    void crashReports.latestCollectionOutcome()
      .then((outcome) => {
        if (active && outcome.status === "report_collected") setVisible(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [runtime, runtimeInstance]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none flex shrink-0 justify-center bg-pane-bg px-3 py-2">
      <section
        aria-label="Ticketry closed unexpectedly last time"
        className="pointer-events-auto flex max-w-xl items-center gap-3 border border-lifecycle-attention/40 bg-pane-panel px-4 py-2 text-sm text-text-primary shadow-lg"
        role="status"
      >
        <span>Ticketry closed unexpectedly last time</span>
        <button
          className="border border-pane-border bg-pane-bg px-2.5 py-1 text-xs font-medium hover:bg-selection-bg"
          onClick={() => {
            void runtime.crashReports?.revealFolder().catch(() => {});
          }}
          type="button"
        >
          Reveal Crash Reports
        </button>
        <button
          aria-label="Dismiss Crash Notice"
          className="px-1.5 py-1 text-text-muted hover:text-text-primary"
          onClick={() => {
            dismissCrashNotice(runtimeInstance);
            setVisible(false);
          }}
          type="button"
        >
          ×
        </button>
      </section>
    </div>
  );
}
