import type { CrashCollectionOutcome, CrashReportsRuntime } from "./contract";
import type { DesktopInvoke } from "./desktopRuntime";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function validateCrashCollectionOutcome(value: unknown): CrashCollectionOutcome {
  const outcome = record(value);
  if (outcome?.status === "none" || outcome?.status === "report_collected") {
    return Object.freeze({ status: outcome.status });
  }
  throw new Error("Desktop initialization failed: Crash Report collection outcome must be none or report_collected");
}

export function desktopCrashReports(invoke: DesktopInvoke): CrashReportsRuntime {
  return Object.freeze({
    latestCollectionOutcome: async () =>
      validateCrashCollectionOutcome(
        await invoke<unknown>("desktop_latest_crash_collection_outcome"),
      ),
    revealFolder: async () => {
      await invoke<void>("desktop_reveal_crash_report_folder");
    },
  });
}
