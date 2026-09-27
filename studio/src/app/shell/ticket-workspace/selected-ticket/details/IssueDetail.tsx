import { lazy, Suspense, useMemo } from "react";
import {
  deriveEpic,
  formatWorkItemDisplayIdentifier,
  useChangeWorkItemType,
  resolveBlockerChips,
  useCreateWorkItem,
  useEditWorkItemDescription,
  useRenameWorkItem,
  useSetWorkItemBlockers,
  useSetWorkItemParent,
  useSetWorkItemState,
  usePlanningFilterStore,
  useWorkItemAttachments,
  StoriesTreeProvider,
  useStoriesTree,
  useWorkItem,
} from "../../../../../features/work-items";
import { dialog, toast, useClientStore } from "../../../../../state/clientStore";
import { useStudioStore } from "../../../../../features/projects";
import { useModulesQuery, useProjectsQuery } from "../../../../../features/projects";
import type { Module, Project } from "../../../../../shared/api/types";
import { apiErrorMessage, isNoOpTransition } from "../../../../../shared/api/errors";
import { deleteWorkItem } from "../../../../../features/work-items";
import { WorkItemNotFoundError } from "../../../../../shared/api/workItemBatcher";
import { useCachedStates } from "../../../../../features/projects";
import { useIssueTypesQuery } from "../../../../../features/settings";
import { usePersistedSubtreeRun } from "../../../../../features/execution";
import { useProjectWorkflowSettings } from "../../../../../features/workflows";
import { openStoryWorkflowGuide } from "../../../../modal/openStoryWorkflowGuide";
import { WorktreeBlock } from "../../../../../features/agents/worktrees";

const EMPTY_MODULES: Module[] = [];
const EMPTY_PROJECTS: Project[] = [];
import NameEditor from "./NameEditor";
import Breadcrumb from "./Breadcrumb";
import Attachments from "./Attachments";
import ChildIssues from "./ChildIssues";
import FindingsPanel from "./FindingsPanel";
import { hasFindingsPanel } from "./internal/findings";
import IssueProperties from "./IssueProperties";
import { IssueToolbar } from "./IssueToolbar";
import IssueTypePicker from "./fields/IssueTypePicker";
import { WorkflowStatePicker } from "./WorkflowStatePicker";
import IssueActionsMenu from "./IssueActionsMenu";
import { NormalRunAction, SubtreeRunAction } from "./NormalRunAction";
import { SerialRunAction } from "./SerialRunAction";
import { RunNowAction } from "./RunNowAction";
import { recordSelectionProfilePoint } from "../../../../../shared/utilities/selectionProfile";

import { taskDetailPoint } from "../../../../../shared/utilities/taskDetailProbe";
import { useTaskDetailCommit } from "../../../../../shared/utilities/useTaskDetailCommit";

const DescriptionEditor = lazy(async () => {
  const probe = taskDetailPoint();
  const started = performance.now();
  probe("description-import-start");
  const loaded = await import("../../../../../features/documents/DescriptionEditor");
  probe("description-import-ready", { import_ms: performance.now() - started });
  return loaded;
});

const NO_CHILD_IDS: string[] = [];

// Details subscribe to the selected normalized record and share list membership.
export default function IssueDetail({
  issueId,
  detailsVisible = true,
}: {
  issueId: string;
  detailsVisible?: boolean;
}) {
  return <StoriesTreeProvider><IssueDetailContent issueId={issueId} detailsVisible={detailsVisible} /></StoriesTreeProvider>;
}

function IssueDetailContent({ issueId, detailsVisible }: { issueId: string; detailsVisible: boolean }) {
  recordSelectionProfilePoint("issue-detail-render");
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const { tree: membership, items, itemsById, loading } = useStoriesTree();
  const { data: selectedTask } = useWorkItem(issueId);
  const task = selectedTask ?? null;
  useTaskDetailCommit(
    issueId,
    selectedModuleId,
    task ? "details-data-ready" : "details-data-pending",
    detailsVisible,
  );
  const taskQuery = {
    isPending: loading,
    error: undefined as Error | undefined,
  };
  const attachments = useWorkItemAttachments(task?.id ?? null).data ?? [];
  const displayedChildIds = task
    ? membership.children[task.id] ?? NO_CHILD_IDS
    : NO_CHILD_IDS;
  const displayedChildren = displayedChildIds.flatMap((id) => itemsById[id] ? [itemsById[id]!] : []);
  const projectContextId = selectedProjectId ?? task?.project_id ?? null;
  const modules = useModulesQuery(projectContextId).data ?? EMPTY_MODULES;
  const projects = useProjectsQuery().data ?? EMPTY_PROJECTS;
  const states = useCachedStates(task?.project_id ?? null);
  const issueTypes = useIssueTypesQuery(task?.project_id ?? null).data ?? [];
  const projectWorkflows = useProjectWorkflowSettings(task?.project_id ?? null);
  const permittedStateIds = useMemo(() => {
    const ids = new Set<string>();
    if (!task?.state) return ids;
    const workflow = projectWorkflows[task.issue_type];
    for (const transition of workflow?.transitions ?? []) {
      if (transition.from_state_id === task.state) ids.add(transition.to_state_id);
    }
    return ids;
  }, [projectWorkflows, task?.issue_type, task?.state]);
  const subtreeDescendantIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set([issueId]);
    const pending = [...(membership.children[issueId] ?? [])];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      pending.push(...(membership.children[id] ?? []));
    }
    return ids;
  }, [issueId, membership]);
  const persistedSubtreeRun = usePersistedSubtreeRun(
    task && task.sub_issues_count > 0 ? task.id : null,
    subtreeDescendantIds,
  );
  const epic = deriveEpic(task, modules, items);
  const moduleMembership =
    task && (epic?.id ?? selectedModuleId)
      ? [{ projectId: task.project_id, moduleId: epic?.id ?? selectedModuleId! }]
      : [];
  const rename = useRenameWorkItem();
  const editDescription = useEditWorkItemDescription();
  const changeType = useChangeWorkItemType();
  const setState = useSetWorkItemState();
  const setChildState = useSetWorkItemState();
  const setParent = useSetWorkItemParent(moduleMembership);
  const setBlockers = useSetWorkItemBlockers();
  const createChild = useCreateWorkItem(
    moduleMembership[0] ?? { projectId: task?.project_id ?? "", moduleId: "" },
  );

  const reportMutationError = (error: Error) => {
    if (!isNoOpTransition(error)) toast.error(apiErrorMessage(error));
  };
  const saving = {
    name: rename.isPending,
    description: editDescription.isPending,
    issue_type_id: changeType.isPending,
    state_id: setState.isPending,
    parent_id: setParent.isPending,
    blocked_by_ids: setBlockers.isPending,
  };

  if (!task && taskQuery.isPending) {
    return <div className="grid h-full place-items-center text-base text-text-muted">Loading issue…</div>;
  }
  if (taskQuery.error instanceof WorkItemNotFoundError) {
    return (
      <div className="grid h-full place-items-center text-center text-base text-text-muted" data-testid="issue-not-found">
        <div>
          <div className="text-text-primary">Issue not found.</div>
          <div className="mt-1">It may have been deleted or the link is wrong.</div>
        </div>
      </div>
    );
  }
  if (!task) {
    if (taskQuery.error) {
      return (
        <div
          className="grid h-full place-items-center px-6 text-center text-base text-lifecycle-danger"
          data-testid="issue-load-error"
        >
          {apiErrorMessage(taskQuery.error)}
        </div>
      );
    }
    return null;
  }

  const project = projects.find((p) => p.id === task.project_id) ?? null;
  const descriptionValue = task.description?.trim() ? task.description : null;

  // Resolve blocker/blocks ids → navigable chips from the loaded project tree.
  const blockedByChips = resolveBlockerChips(task.blocked_by_ids, items, modules, states);
  const blocksChips = resolveBlockerChips(task.blocks_ids, items, modules, states);

  const replaceBlockers = (blockedByIds: string[]) =>
    setBlockers.mutate(
      { id: task.id, blockedByIds },
      { onError: reportMutationError },
    );
  const removeBlocker = (id: string) =>
    replaceBlockers(task.blocked_by_ids.filter((candidate) => candidate !== id));
  const addBlocker = (id: string) =>
    replaceBlockers([...task.blocked_by_ids, id]);
  const cancelChild = (id: string) => {
    const cancelled = states.find(
      (state): state is typeof state & { id: string } =>
        state.group === "cancelled" && state.id !== null,
    );
    if (!cancelled) {
      toast.error("No Cancelled state is configured for this project.");
      return;
    }
    setChildState.mutate(
      { id, state: cancelled },
      { onError: reportMutationError },
    );
  };

  // Breadcrumb epic segment → the backlog scoped to that epic. The selection
  // is the shared planning axis (#833); load the project's selection first so
  // the write persists under the right key even on a cold deep-link.
  const scopeEpics = (epicIds: string[]) => {
    const planning = usePlanningFilterStore.getState();
    const projectId = selectedProjectId ?? task.project_id;
    if (planning.projectId !== projectId) planning.setProject(projectId);
    usePlanningFilterStore.getState().setEpicIds(epicIds);
  };

  const goEpic = () => {
    if (!epic) return;
    scopeEpics([epic.id]);
  };

  // Breadcrumb Project segment → the project's full backlog (epic filter cleared
  // so it isn't scoped to whatever was last selected).
  const goProject = () => {
    scopeEpics([]);
  };

  const onDelete = async () => {
    if (task.sub_issues_count > 0) return;
    // G01: a destructive action asks first. Cancel aborts with no mutation.
    const identifier = formatWorkItemDisplayIdentifier(task.sequence_id);
    const ok = await dialog.confirm({
      title: "Delete issue",
      body: `${identifier ? `${identifier} ` : ""}'${task.name}' will be permanently deleted.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteWorkItem(task.id, { moduleId: epic?.id ?? selectedModuleId ?? undefined });
  };

  return (
    <section
      role="region"
      aria-label="Details"
      className="flex h-full flex-col overflow-hidden"
    >
      <IssueToolbar
        actions={
          <>
            <RunNowAction
              item={task}
              moduleId={epic?.id ?? null}
              states={states}
              issueTypes={issueTypes}
            />
            <SubtreeRunAction
              key={`subtree-run-${task.id}`}
              task={task}
              moduleId={epic?.id ?? selectedModuleId ?? null}
              activeRun={persistedSubtreeRun.activeRun}
              runStateLoading={persistedSubtreeRun.loading}
              refreshRunState={persistedSubtreeRun.refresh}
            />
            <SerialRunAction
              key={`serial-run-${task.id}`}
              task={task}
              moduleId={epic?.id ?? selectedModuleId ?? null}
              activeRun={persistedSubtreeRun.activeRun}
              runStateLoading={persistedSubtreeRun.loading}
              refreshRunState={persistedSubtreeRun.refresh}
            />
            <NormalRunAction
              key={`normal-run-${task.id}`}
              task={task}
              moduleId={epic?.id ?? selectedModuleId ?? null}
            />
            <WorktreeBlock
              taskId={task.id}
              parentId={task.parent_id}
              moduleId={epic?.id ?? selectedModuleId}
              onViewChanges={() => {
                const workspace = useClientStore.getState();
                workspace.ensureWorkspace(task.id);
                workspace.setActive(task.id, "changes");
              }}
            />
            <IssueTypePicker
              projectId={task.project_id}
              value={task.issue_type}
              saving={Boolean(saving.issue_type_id)}
              onChange={(issueType) =>
                changeType.mutate(
                  { id: task.id, issueType },
                  { onError: reportMutationError },
                )
              }
            />
            <WorkflowStatePicker
              task={task}
              states={states}
              workflow={projectWorkflows[task.issue_type]}
              permittedStateIds={permittedStateIds}
              saving={Boolean(saving.state_id)}
              onStateChange={(state) =>
                setState.mutate(
                  { id: task.id, state },
                  { onError: reportMutationError },
                )
              }
              onOpenGuide={
                issueTypes.find((type) => type.id === task.issue_type)?.name === "Story"
                  ? () => openStoryWorkflowGuide(task.id)
                  : undefined
              }
            />
          </>
        }
        location={
          <Breadcrumb
            project={project}
            epic={epic}
            task={task}
            items={items}
            savingParent={Boolean(saving.parent_id)}
            setParent={(parentId) =>
              setParent.mutate(
                {
                  id: task.id,
                  parentId,
                  moduleId: epic?.id ?? selectedModuleId ?? undefined,
                },
                { onError: reportMutationError },
              )
            }
            onProjectClick={goProject}
            onEpicClick={goEpic}
          />
        }
        menu={
          <IssueActionsMenu
            taskId={task.id}
            moduleId={epic?.id ?? selectedModuleId}
            hasSubtasks={task.sub_issues_count > 0}
            onDelete={onDelete}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="w-full min-w-0 px-4 py-2"
          data-testid="details-document"
          ref={(element) => {
            if (element && detailsVisible) {
              taskDetailPoint(task.id)("details-document-ready");
            }
          }}
        >
          <NameEditor
            name={task.name}
            saving={Boolean(saving.name)}
            onSave={(name) =>
              rename.mutate(
                { id: task.id, name },
                { onError: reportMutationError },
              )
            }
          />

          <IssueProperties
            task={task}
            saving={saving}
            blockedByChips={blockedByChips}
            blocksChips={blocksChips}
            items={items}
            addBlocker={addBlocker}
            removeBlocker={removeBlocker}
          />

          <div className="pt-2">
            <div className="font-mono font-normal">
              <Suspense fallback={null}>
                <DescriptionEditor
                  key={task.id}
                  issueId={task.id}
                  value={descriptionValue}
                  detailsVisible={detailsVisible}
                  onSave={(description) =>
                    editDescription.mutateAsync(
                      { id: task.id, description },
                      { onError: reportMutationError },
                    )
                  }
                />
              </Suspense>
            </div>
          </div>

          <Attachments attachments={attachments} />

          {hasFindingsPanel(task, states, issueTypes) && (
            <FindingsPanel
              children={displayedChildren}
              projectId={task.project_id}
              onCancel={cancelChild}
            />
          )}

          <ChildIssues
            children={displayedChildren}
            projectId={task.project_id}
            onAddSubtask={(name, issueTypeId) =>
              createChild.mutate(
                {
                  name,
                  parent_id: task.id,
                  issue_type_id: issueTypeId,
                },
                { onError: reportMutationError },
              )
            }
          />
        </div>
      </div>
    </section>
  );
}
