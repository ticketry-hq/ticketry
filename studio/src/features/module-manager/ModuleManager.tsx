import { useQuery } from "@apollo/client/react";
import { studioApolloClient } from "../../shared/apollo/client";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import { useModuleLinks } from "../module-links";
import { useEffectiveModuleTabs, type ModuleTabEntry } from "../module-tabs";
import { WorkTrackerProjectOpenDocument, useModulesQuery, useStudioStore } from "../projects";
import { useProjectStorySprintIndex } from "../work-items";
import { ModuleManagerView } from "./ModuleManagerView";
import { useArchivedModules } from "./useArchivedModules";
import { useModuleManagerStore } from "./state";

function ModuleManagerContents() {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const modules = useModulesQuery(projectId);
  const projection = useEffectiveModuleTabs(projectId, modules.data);
  const archived = useArchivedModules(projectId);
  const eligibility = useProjectStorySprintIndex(projectId, "cache-only");
  const links = useModuleLinks();
  const project = useQuery(WorkTrackerProjectOpenDocument, { client: studioApolloClient(), fetchPolicy: "cache-only",
    skip: !projectId, variables: { projectId: projectId ? compactWorktrackerId(projectId) : "" } });
  const entries = new Map<string, ModuleTabEntry>();
  for (const entry of projection.entries) entries.set(entry.module.id, entry);
  for (const module of archived.modules) {
    if (module.project_id === projectId && module.is_archived) entries.set(module.id, { module, status: "archived", sprintEligible: null });
  }
  const folders: Record<string, string> = {};
  const accents: Record<string, string | null> = {};
  for (const { module } of entries.values()) {
    const link = links.find((candidate) => compactWorktrackerId(candidate.moduleId) === compactWorktrackerId(module.id));
    if (link) folders[module.id] = link.path;
    accents[module.id] = project.data?.issue_types.nodes.find((type) => publicWorktrackerId(type.id) === module.issue_type)?.color ?? null;
  }
  return <ModuleManagerView key={projectId + ":" + projection.projectGeneration} projectId={projectId} projectName={project.data?.project.nodes.find(({ id }) => publicWorktrackerId(id) === projectId)?.name ?? ""}
    entries={[...entries.values()]} folders={folders} accents={accents} loading={modules.loading || projection.loading}
    reorderEnabled={!modules.loading && projection.complete && !projection.restricted}
    eligibilityError={projection.restricted ? eligibility.error : undefined} onRetryEligibility={() => { void eligibility.retry().catch(() => {}); }}
    archivedLoading={archived.loading} archivedError={archived.error} onRetryArchived={() => { void archived.retry(); }} />;
}

/** View lifetime starts with manager visibility; normal project-open membership stays untouched. */
export function ModuleManager() {
  const active = useModuleManagerStore((state) => state.active);
  return active ? <ModuleManagerContents /> : null;
}
