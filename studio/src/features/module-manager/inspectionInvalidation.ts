import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";

type Refresh = () => Promise<void>;
interface Registration { projectId: string; moduleId: string; kind: "metadata" | "stories" | "archive"; refresh: Refresh }
// Transient mounted reader callbacks only. Collection data and read state remain in Apollo.
const readers = new Set<Registration>();
export function subscribeInspectionInvalidation(projectId: string, moduleId: string, refresh: Refresh, kind: Registration["kind"] = "metadata") {
  const entry = { projectId: compactWorktrackerId(projectId), moduleId: compactWorktrackerId(moduleId), refresh, kind };
  readers.add(entry); return () => { readers.delete(entry); };
}
export async function invalidateModuleInspections(projectIds?: readonly string[], moduleIds?: readonly string[]): Promise<void> {
  const projects = projectIds?.map(compactWorktrackerId); const modules = moduleIds?.map(compactWorktrackerId);
  const selected = new Map<string, Registration>();
  for (const reader of readers) {
    if (projects?.length && !projects.includes(reader.projectId)) continue;
    if (modules?.length && !modules.includes(reader.moduleId)) continue;
    selected.set(`${reader.projectId}:${reader.moduleId}:${reader.kind}`, reader);
  }
  await Promise.all([...selected.values()].map(({ refresh }) => refresh()));
}
