import { studioRuntime } from "../../runtime";
import { useAppUpdateState } from "./internal/updateState";

export function useAppUpdateAvailable(): boolean {
  const status = useAppUpdateState((state) => state.update.status);
  return studioRuntime().capabilities.appUpdates && status === "available";
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
