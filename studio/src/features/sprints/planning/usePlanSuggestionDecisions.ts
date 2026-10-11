import { useEffect, useRef, useState } from "react";
import { createApolloStore } from "../../../shared/apollo/localState";
import { toast } from "../../../state/clientStore";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { readSuggestionReadiness, suggestionReadScope, useSuggestionReadiness } from "../suggestionReadiness";
import { useUpdateSprintSuggestion } from "../mutations";
import type { SuggestionWriteOutcome } from "../useUpdateSprintSuggestion";
import { openPlanItem, usePlanWorkspace } from "../planWorkspaceState";
import { clearProposalTitle, editedProposalTitle } from "./ProposedStoryDraft";

type Decision = { id: string; name: string; status: "accepted" | "dismissed" };
type DecisionSubject = Pick<SprintSuggestionRecordFragment, "id" | "issue" | "proposedName">;
type DecisionStatus = "accepted" | "dismissed" | "waiting";
export type DecisionFailure = { suggestion: DecisionSubject; status: DecisionStatus; proposedName?: string };
type Selection = { generation: number; version: number; suggestionId: string };
export type DecisionRecovery =
  | { kind: "refreshFailed"; selection: Selection; issueId?: string }
  | { kind: "inspectScope"; selection: Selection }
  | { kind: "unconfirmed"; command: DecisionFailure; selection: Selection };
const useDecisionFeedback = createApolloStore<{ decision: Decision | null; failure: DecisionFailure | null; recovery: DecisionRecovery | null }>(
  "plan-suggestion-feedback", () => ({ decision: null, failure: null, recovery: null }),
);

/** Decisions and Undo share the restricted suggestion update; Rust owns membership and proposal conversion. */
export function usePlanSuggestionDecisions(projectId: string, sprintId: string, onDecision: () => void, policy: { isCurrent: () => boolean; canChange: (id: string, status: DecisionStatus, confirmedBatch?: boolean) => boolean }) {
  const { update, refresh, inspect, busy } = useUpdateSprintSuggestion({ projectId, sprintId });
  const readiness = useSuggestionReadiness(projectId, sprintId);
  useDecisionFeedback.getState();
  const { decision, failure, recovery } = useDecisionFeedback();
  const pending = useRef(false);
  const batchPending = useRef(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const mounted = useRef(false);
  const reset = () => useDecisionFeedback.setState({ decision: null, failure: null, recovery: null });
  const clear = () => { if (useDecisionFeedback.getState().recovery) { useDecisionFeedback.setState({ decision: null, failure: null }); return; } reset(); };
  useEffect(() => {
    mounted.current = true; reset();
    if (readiness.needsRead) {
      const workspace = usePlanWorkspace.getState();
      useDecisionFeedback.setState({ recovery: { kind: "inspectScope", selection: { generation: workspace.generation, version: workspace.itemRequestVersion, suggestionId: "" } } });
    }
    return () => { mounted.current = false; reset(); };
  }, []);
  const currentVisit = (selection: Selection) => mounted.current && policy.isCurrent() && usePlanWorkspace.getState().generation === selection.generation;
  const followSelection = (selection: Selection, status: DecisionStatus, issueId?: string) => {
    const current = usePlanWorkspace.getState();
    if (!currentVisit(selection) || current.itemRequestVersion !== selection.version ||
        (current.pendingOpenItem ?? current.openItem) !== `suggestion:${selection.suggestionId}`) return;
    if (status === "accepted" && issueId) void openPlanItem(issueId);
    else if (status === "dismissed") usePlanWorkspace.setState({ openItem: null, pendingOpenItem: null });
  };
  const receive = (outcome: SuggestionWriteOutcome, command: DecisionFailure, selection: Selection): boolean => {
    if (!currentVisit(selection)) return false;
    if (outcome.kind === "rejected") {
      useDecisionFeedback.setState({ failure: outcome.suggestion ? { ...command, suggestion: outcome.suggestion } : command, recovery: outcome.suggestion ? null : useDecisionFeedback.getState().recovery });
      return false;
    }
    if (outcome.kind === "unconfirmed") {
      useDecisionFeedback.setState({ failure: null, recovery: { kind: "unconfirmed", command, selection } });
      return false;
    }
    const result = outcome.suggestion;
    const status = command.status;
    onDecision();
    if (status === "accepted") clearProposalTitle(command.suggestion.id);
    useDecisionFeedback.setState({ failure: null,
      recovery: outcome.refreshFailed ? { kind: "refreshFailed", selection, ...(status === "accepted" && result.issue?.id ? { issueId: result.issue.id } : {}) } : null,
      decision: status === "waiting" ? null : { id: result.id, status, name: result.issue?.name ?? command.suggestion.proposedName ?? "Suggested story" },
    });
    followSelection(selection, status, result.issue?.id);
    return !outcome.refreshFailed;
  };
  const change = async (suggestion: DecisionSubject, status: DecisionStatus, proposedName?: string, inBatch = false, confirmedBatch = false): Promise<boolean> => {
    if (pending.current || suggestionReadScope(projectId, sprintId).pending() || (batchPending.current && !inBatch) || (useDecisionFeedback.getState().recovery?.kind === "unconfirmed" || useDecisionFeedback.getState().recovery?.kind === "inspectScope") || !policy.canChange(suggestion.id, status, confirmedBatch)) return false;
    const title = status === "accepted" && !suggestion.issue
      ? (proposedName ?? editedProposalTitle(suggestion.id))?.trim() : undefined;
    if (title !== undefined && (!title || Array.from(title).length > 512)) {
      toast.error("Enter a story title between 1 and 512 characters.");
      return false;
    }
    const workspace = usePlanWorkspace.getState();
    const selection = { generation: workspace.generation, version: workspace.itemRequestVersion, suggestionId: suggestion.id };
    const command = { suggestion, status, ...(title === undefined ? {} : { proposedName: title }) };
    pending.current = true;
    try {
      return receive(await update({ id: suggestion.id, status, ...(title !== undefined && title !== suggestion.proposedName ? { proposedName: title } : {}) }), command, selection);
    } finally { pending.current = false; }
  };
  const acceptAll = async (suggestions: readonly SprintSuggestionRecordFragment[]) => {
    if (pending.current || batchPending.current) return;
    batchPending.current = true;
    setBatchBusy(true);
    try {
      let confirmed = false;
      for (const suggestion of [...suggestions]) {
        if (!await change(suggestion, "accepted", undefined, true, confirmed)) break;
        confirmed = true;
      }
    } finally { batchPending.current = false; setBatchBusy(false); }
  };
  const retryRefresh = async () => {
    if (pending.current || suggestionReadScope(projectId, sprintId).pending() || !policy.isCurrent() || !recovery) return;
    pending.current = true; setBatchBusy(true);
    const reads = suggestionReadScope(projectId, sprintId);
    const revision = reads.begin();
    try {
      if (recovery.kind === "unconfirmed") {
        const command = recovery.command;
        receive(await inspect({ id: command.suggestion.id, status: command.status }), command, recovery.selection);
      } else {
        await refresh();
        if (currentVisit(recovery.selection)) {
          if (recovery.kind === "refreshFailed" && recovery.issueId) followSelection(recovery.selection, "accepted", recovery.issueId);
          useDecisionFeedback.setState({ recovery: null });
        }
      }
    } catch { /* Retain read-only recovery. */ }
    finally { reads.finish(revision, readSuggestionReadiness(projectId, sprintId).needsRead); pending.current = false; setBatchBusy(false); }
  };
  return { busy: busy || batchBusy || readiness.pending, blocked: recovery?.kind === "unconfirmed" || recovery?.kind === "inspectScope", decision, failure, recovery, clear, change, acceptAll, retryRefresh,
    retry: () => { if (failure) void change(failure.suggestion, failure.status, failure.proposedName); },
    undo: () => { if (decision) void change({ id: decision.id, issue: null, proposedName: decision.name }, "waiting"); },
  };
}
