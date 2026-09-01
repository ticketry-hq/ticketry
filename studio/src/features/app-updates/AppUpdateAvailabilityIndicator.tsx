import { studioRuntime } from "../../runtime";
import { useAppUpdateCheckState } from "./internal/checkState";

export function useAppUpdateAvailable(): boolean {
  const status = useAppUpdateCheckState((state) => state.state.status);
  return (
    studioRuntime().capabilities.appUpdates &&
    (status === "ready-to-install" ||
      status === "downloading" ||
      status === "installing" ||
      status === "restart-requested")
  );
}

export function AppUpdateAvailabilityIndicator({
  descriptionId,
}: {
  descriptionId: string;
}) {
  const updateAvailable = useAppUpdateAvailable();
  if (!updateAvailable) return null;

  return (
    <>
      <span id={descriptionId} className="sr-only">
        Update available
      </span>
      <span
        aria-hidden="true"
        title="Update available"
        className="size-1.5 bg-lifecycle-attention"
      />
    </>
  );
}
