import { gql } from "@apollo/client";
import { useApolloClient } from "@apollo/client/react";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { useEffect, useRef } from "react";
import { ROADMAP_ENABLED } from "../../../shared/config/roadmapAvailability";
import { toast } from "../../../state/clientStore";
import { adaptPlanningGraph, backlogCandidates, PlanningGraphDocument, type PlanningGraph } from "../../planning-graph";
import { useStudioStore } from "../../projects";
import { SprintSuggestionsDocument } from "../generated/sprints.documents";
import { readSuggestionReadiness, useSuggestionReadiness } from "../suggestionReadiness";
import { setPlanVisit, usePlanWorkspace, type PlanVisit } from "../planWorkspaceState";
import { availablePlanEpics, epicOf, suggestionEpicOf, waitingForEpic, type EpicSuggestion, type PlanEpic } from "./epicMembership";
import { closeEpicTab, reconcileEpicTabs, stepEpicTab } from "./epicTabs";
import { groupByEpic } from "./planGroups";
import { usePlanMoves } from "./usePlanMoves";
import { planMoveEligibility } from "./planMovePolicy";
import type { Move } from "./moveFeedback";
import { createdEpicOwner, observeCreatedEpics, pendingPlanEpics, rememberCreatedEpic, usePlanCreatedEpics } from "./planCreatedEpics";

interface VisitInputs<Suggestion extends EpicSuggestion = EpicSuggestion> {
  graph: PlanningGraph | null;
  loading: boolean;
  error: string | null;
  suggestions: Suggestion[];
  suggestionsLoading: boolean;
  suggestionsError: unknown;
  suggestionsIncomplete?: boolean;
}

const currentAssignment = gql`fragment PlanMoveCurrentAssignment on WorktrackerIssue { id sprintId }`;

const emptyVisit: PlanVisit = { epicTabs: [], activeEpicId: null };
const noPendingCreated: string[] = [];

function sameVisit(left: PlanVisit | undefined, right: PlanVisit): boolean {
  return Boolean(left && left.activeEpicId === right.activeEpicId &&
    left.epicTabs.length === right.epicTabs.length &&
    left.epicTabs.every((id, index) => id === right.epicTabs[index]));
}

/** One mounted owner for remembered epic intent and both Plan panes. */
export function usePlanVisitCoordinator<Suggestion extends EpicSuggestion>(projectId: string, sprintId: string, inputs: VisitInputs<Suggestion>) {
  const client = useApolloClient();
  const suggestionReadiness = useSuggestionReadiness(projectId, sprintId);
  const workspace = usePlanWorkspace();
  const generation = workspace.generation;
  const owner = createdEpicOwner(projectId, sprintId);
  const pendingCreated = usePlanCreatedEpics((state) => state.pending[owner] ?? noPendingCreated);
  const saved = workspace.visits[sprintId];
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isCurrent = () => {
    const current = usePlanWorkspace.getState();
    return mounted.current && ROADMAP_ENABLED && current.active && current.projectId === projectId &&
      current.sprintId === sprintId && current.generation === generation &&
      useStudioStore.getState().selectedProjectId === projectId;
  };
  const actionable = (data: VisitInputs) => ROADMAP_ENABLED &&
    data.graph?.project?.id === projectId &&
    Boolean(data.graph?.sprints.some((sprint) => sprint.id === sprintId));
  const recordsReady = (data: VisitInputs) => actionable(data) && !data.loading && !data.error &&
    !data.suggestionsLoading && !data.suggestionsError && !data.suggestionsIncomplete;
  const ready = (data: VisitInputs) => recordsReady(data) && readSuggestionReadiness(projectId, sprintId).ready;
  const available = (data: VisitInputs): PlanEpic[] => {
    if (!data.graph) return [];
    const epics = availablePlanEpics(data.graph, data.suggestions, sprintId);
    return [...epics, ...pendingPlanEpics(owner).filter((epic) => !epics.some((existing) => existing.id === epic.id))];
  };
  const resolve = (data: VisitInputs, intent: PlanVisit | undefined) =>
    ready(data) ? reconcileEpicTabs(intent ?? emptyVisit, available(data)) : intent ?? emptyVisit;

  // Effects and commands can run after a newer query/cache update or selection.
  // Re-read both records and intent rather than persisting the rendered visit.
  const latestInputs = (cacheOnly = false): VisitInputs => {
    const graph = client.readQuery({ query: PlanningGraphDocument, variables: { projectId }, optimistic: true });
    const suggestions = client.readQuery({ query: SprintSuggestionsDocument, variables: { sprintId }, optimistic: true });
    const results = [...client.getObservableQueries("active")].filter((query) =>
      query.queryName === "PlanningGraph" && compactWorktrackerId(String(query.variables.projectId)) === compactWorktrackerId(projectId))
      .map((query) => query.getCurrentResult());
    const suggestionResults = [...client.getObservableQueries("active")].filter((query) =>
      query.queryName === "SprintSuggestions" && compactWorktrackerId(String(query.variables.sprintId)) === compactWorktrackerId(sprintId))
      .map((query) => query.getCurrentResult());
    return { ...inputs, loading: results.length ? results.some((result) => result.loading) : inputs.loading,
      error: results.length ? results.find((result) => result.error)?.error?.message ?? null : inputs.error,
      graph: graph ? adaptPlanningGraph(graph) : !cacheOnly && !results.length ? inputs.graph : null,
      suggestionsLoading: suggestionResults.length ? suggestionResults.some((result) => result.loading) : inputs.suggestionsLoading,
      suggestionsError: suggestionResults.length ? suggestionResults.find((result) => result.error)?.error ?? null : inputs.suggestionsError,
      suggestionsIncomplete: suggestionResults.length > 0 && suggestions === null,
      suggestions: suggestions?.worktrackerSprintSuggestion.nodes ?? (cacheOnly ? [] : inputs.suggestions) };
  };
  const writeVisit = (next: PlanVisit) => {
    if (!isCurrent()) return false;
    if (!sameVisit(usePlanWorkspace.getState().visits[sprintId], next)) setPlanVisit(sprintId, next);
    return true;
  };

  const observedInputs = latestInputs();
  // Collection invalidation can briefly remove a complete cache read while
  // usePlanningGraph retains the displayed result. Keep its mounted editors;
  // commands below still read the current cache through latestInputs.
  const renderedInputs = { ...observedInputs, graph: observedInputs.graph ?? inputs.graph };
  useEffect(() => {
    if (!isCurrent()) return;
    const data = latestInputs();
    if (!ready(data)) return;
    observeCreatedEpics(owner, data.graph!.modules);
    writeVisit(resolve(data, usePlanWorkspace.getState().visits[sprintId]));
  }, [projectId, sprintId, generation, saved, pendingCreated, inputs.graph, inputs.loading,
    inputs.error, inputs.suggestions, inputs.suggestionsLoading, inputs.suggestionsError, renderedInputs.loading, renderedInputs.error, renderedInputs.suggestionsIncomplete, suggestionReadiness.ready]);

  const epics = available(renderedInputs);
  const visit = resolve(renderedInputs, saved);
  const activeEpicId = visit.activeEpicId;
  const backlogItems = renderedInputs.graph ? backlogCandidates(renderedInputs.graph) : [];
  const backlog = groupByEpic(epics, backlogItems, new Set(activeEpicId ? [activeEpicId] : []));
  const sprintPane = groupByEpic(epics,
    renderedInputs.graph?.workItems.filter((item) => item.sprintId === sprintId && item.typeName === "Story") ?? [])
    .sort((left, right) => Number(right.epic.id === activeEpicId) - Number(left.epic.id === activeEpicId));
  const waiting = inputs.suggestions.filter((suggestion) => suggestion.sprintId === sprintId && suggestion.status === "waiting");
  const activeSuggestions = waiting.filter((suggestion) => suggestionEpicOf(suggestion, epics) === activeEpicId);
  const label = (epicId: string) => {
    const name = epics.find((epic) => epic.id === epicId)?.name ?? "Deleted epic";
    const count = backlogItems.filter((item) => epicOf(item, epics) === epicId).length;
    const waiting = waitingForEpic(renderedInputs.suggestions, sprintId, epicId, epics);
    return { name, count, waiting, accessible: `${name}, ${count} backlog stories${waiting ? `, ${waiting} waiting suggestions` : ""}` };
  };
  const select = (epicId: string) => {
    if (!isCurrent()) return false;
    const data = latestInputs();
    if (!actionable(data)) return false;
    if (!available(data).some((epic) => epic.id === epicId)) return false;
    const current = resolve(data, usePlanWorkspace.getState().visits[sprintId]);
    return writeVisit({ epicTabs: current.epicTabs.includes(epicId) ? current.epicTabs : [...current.epicTabs, epicId], activeEpicId: epicId });
  };
  const created = (epicId: string) => {
    if (!isCurrent() || !actionable(latestInputs()) || usePlanWorkspace.getState().visits[sprintId] !== saved) return false;
    rememberCreatedEpic(owner, epicId);
    return select(epicId);
  };
  const close = (epicId: string, source: "tab" | "done") => {
    if (!isCurrent()) return false;
    const data = latestInputs();
    if (!actionable(data)) return false;
    const current = resolve(data, usePlanWorkspace.getState().visits[sprintId]);
    if (!current.epicTabs.includes(epicId)) return false;
    if (!writeVisit(closeEpicTab(current, epicId))) return false;
    const currentEpics = available(data);
    const waiting = waitingForEpic(data.suggestions, sprintId, epicId, currentEpics);
    if (waiting) toast.info(source === "done"
      ? `${waiting} suggestions are still waiting. Find this epic in Add epic.`
      : `${waiting} suggestions still waiting for ${currentEpics.find((epic) => epic.id === epicId)?.name ?? "Deleted epic"}. Find them in Add epic.`);
    return true;
  };
  const next = () => {
    if (!isCurrent()) return false;
    const data = latestInputs();
    if (!actionable(data)) return false;
    return writeVisit(stepEpicTab(resolve(data, usePlanWorkspace.getState().visits[sprintId]), 1));
  };

  const currentMoveData = () => latestInputs(true);
  // Collection eviction/loading must not look like an observed assignment change.
  const sprintOf = (id: string) => {
    const graph = client.readQuery({ query: PlanningGraphDocument, variables: { projectId }, optimistic: true });
    if (graph) return graph.workItems.nodes.find((item) => item.id === id)?.sprintId;
    return client.readFragment<{ sprintId: string | null }>({
      id: client.cache.identify({ __typename: "WorktrackerIssue", id }), fragment: currentAssignment, optimistic: true,
    })?.sprintId;
  };
  const eligibility = (move: Move) => {
    const data = currentMoveData();
    return planMoveEligibility(data.graph, sprintId, available(data), resolve(data, usePlanWorkspace.getState().visits[sprintId]).activeEpicId,
      !isCurrent() || !actionable(data) || data.loading || Boolean(data.error), move);
  };
  const moves = usePlanMoves(sprintOf, eligibility, isCurrent);
  const requestMove = (id: string, into: boolean) => {
    if (!isCurrent()) return;
    const item = currentMoveData().graph?.workItems.find((candidate) => candidate.id === id);
    if (item) void moves.move({ itemId: id, key: item.key, from: item.sprintId, to: into ? sprintId : null });
  };
  const canMove = (id: string, into: boolean) => {
    const item = currentMoveData().graph?.workItems.find((candidate) => candidate.id === id);
    return Boolean(item && !moves.isPending(id) && eligibility({ itemId: id, key: item.key, from: item.sprintId, to: into ? sprintId : null }).kind === "eligible");
  };
  const canDecideSuggestion = (status: "accepted" | "dismissed" | "waiting", id?: string, confirmedBatch = false) => {
    const data = latestInputs(true);
    const readiness = readSuggestionReadiness(projectId, sprintId);
    // Only an already-confirmed batch may continue through a background graph refetch.
    // Cache completeness, read errors, suggestion reads and visit identity still gate it.
    const commandData = confirmedBatch && readiness.ready ? { ...data, loading: false } : data;
    if (!isCurrent() || !recordsReady(commandData) || readiness.pending) return false;
    if (status === "accepted" && data.graph!.sprints.find((sprint) => sprint.id === sprintId)?.status === "completed") return false;
    if (!id) return true;
    const suggestion = data.suggestions.find((candidate) => "id" in candidate && candidate.id === id && candidate.sprintId === sprintId);
    return Boolean(suggestion && (status === "waiting" ? suggestion.status === "accepted" || suggestion.status === "dismissed" : suggestion.status === "waiting"));
  };

  return { moves, requestMove, canMove, visit, epics, activeEpicId, backlog, sprintPane, activeSuggestions, waitingCount: waiting.length,
    label, select, created, close, next, isCurrent, canDecideSuggestion };
}

export type PlanVisitCoordinator = ReturnType<typeof usePlanVisitCoordinator>;
