import type { DownloadProgress } from "./internal/updateMachine";

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Download progress for the update the user asked to install.
 *
 * A feed that declares no total gives an indeterminate download: the bar has
 * no fill and the received bytes stand in for a percentage, so the user still
 * sees the download moving.
 */
export function UpdateDownloadProgress({
  progress,
}: {
  progress: DownloadProgress;
}) {
  const percent = progress.percent;
  const downloaded = percent !== null && percent >= 100;
  const valueText =
    percent === null
      ? `${megabytes(progress.receivedBytes)} downloaded`
      : `${Math.round(percent)}%`;

  return (
    <div role="status" className="mt-4">
      <p className="text-sm text-text-secondary">
        {downloaded ? "Installing update" : "Downloading update"} — {valueText}
      </p>
      <div
        role="progressbar"
        aria-label="Update download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === null ? {} : { "aria-valuenow": Math.round(percent) })}
        aria-valuetext={valueText}
        className="mt-2 h-1 w-full max-w-xs bg-pane-border"
      >
        <div
          className="h-full bg-lifecycle-attention"
          style={{ width: percent === null ? "0%" : `${percent}%` }}
        />
      </div>
    </div>
  );
}
