import type { ModuleInspectionMetadata, InspectionMetric } from "./useModuleInspectionMetadata";

function metricLabel(metric: InspectionMetric, singular: string) {
  const plural = singular === "story" ? "stories" : singular + "s";
  return metric.state === "available" ? `${metric.count} ${metric.count === 1 ? singular : plural}`
    : `${plural[0]!.toUpperCase()}${plural.slice(1)} ${metric.state === "loading" ? "loading…" : metric.state}`;
}
export function activityLabel(activity: ModuleInspectionMetadata["activity"]) {
  if (activity.state !== "available" || !activity.at) return `Activity ${activity.state === "loading" ? "loading…" : activity.state}`;
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(activity.at)) / 60000));
  if (minutes < 1) return "Active just now";
  if (minutes < 60) return `Active ${minutes}m ago`;
  if (minutes < 1440) return `Active ${Math.floor(minutes / 60)}h ago`;
  return `Active ${Math.floor(minutes / 1440)}d ago`;
}
export function ModuleManagerMetadata({ metadata, folder }: { metadata: ModuleInspectionMetadata; folder?: string }) {
  return <span className="block min-w-0 truncate text-[11px] text-text-muted" title={folder}>
    <span>{metricLabel(metadata.stories, "story")}</span><span aria-hidden="true"> · </span>
    <span>{metricLabel(metadata.agents, "agent")}</span><span aria-hidden="true"> · </span>
    <span>{metricLabel(metadata.worktrees, "worktree")}</span><span aria-hidden="true"> · </span>
    <span title={metadata.activity.at ?? undefined}>{activityLabel(metadata.activity)}</span><span aria-hidden="true"> · </span>
    <span>{folder ?? "Folder not linked"}</span>
  </span>;
}
