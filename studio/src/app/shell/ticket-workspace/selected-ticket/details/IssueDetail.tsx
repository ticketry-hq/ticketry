import { lazy, Suspense, useState } from "react";
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
  useWorkItem,
  useWorkItemAttachments,
  useWorkItemsByIds,
} from "../../../../../features/work-items";
import { dialog, toast, useClientStore } from "../../../../../state/clientStore";
import { useStudioStore } from "../../../../../features/projects";
import { useModulesQuery, useProjectsQuery } from "../../../../../features/projects";
import type { Module, Project } from "../../../../../shared/api/types";
import { apiErrorMessage, isNoOpTransition } from "../../../../../shared/api/errors";
import { deleteWorkItem } from "../../../../../features/work-items";
import { queryClient } from "../../../../../shared/query/queryClient";
import { queryKeys } from "../../../../../shared/query/keys";
import { WorkItemNotFoundError } from "../../../../../shared/api/workItemBatcher";
import { useCachedStates } from "../../../../../shared/query/stateCatalog";
import { useModuleTree } from "../../../../../features/work-items";
import { useIssueTypesQuery } from "../../../../../features/settings";

const EMPTY_MODULES: Module[] = [];
const EMPTY_PROJECTS: Project[] = [];
import StatePicker from "./fields/StatePicker";
import { IconPanelLeft } from "../../../../../shared/ui/icons";

import NameEditor from "./NameEditor";
import Breadcrumb from "./Breadcrumb";
import Attachments from "./Attachments";
import ChildIssues from "./ChildIssues";
import FindingsPanel from "./FindingsPanel";
import { hasFindingsPanel } from "./internal/findings";
import IssueSidebar from "./IssueSidebar";
import IssueActionsMenu from "./IssueActionsMenu";
import { LaunchAgentAction } from "./LaunchAgentAction";
import { SubtreeRunActions } from "./SubtreeRunActions";
import { RunNowAction } from "./RunNowAction";
import { readVersionedItem } from "../../../../../shared/storage/versioned";

const DescriptionEditor = lazy(() => import("../documents/DescriptionEditor"));

// The Details sidebar's visibility persists globally (#837).
const SIDEBAR_KEY = "studio.issueDetail.sidebarVisible:v1";
const LEGACY_SIDEBAR_KEYS = ["studio.issueDetail.sidebarVisible"];
const NO_CHILD_IDS: string[] = [];

function readSidebarVisible(): boolean {
  return readVersionedItem(SIDEBAR_KEY, LEGACY_SIDEBAR_KEYS) !== "0";
}

// The two-pane issue body reads the same per-id holding as the Stories row.
// A mounted query requests only when that holding is genuinely absent.
export default function IssueDetail({ issueId }: { issueId: string }) {
  const taskQuery = useWorkItem(issueId);
  const task = taskQuery.data ?? null;
  const attachments = useWorkItemAttachments(task?.id ?? null).data ?? [];
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const membership = useModuleTree(selectedProjectId, selectedModuleId);
  const items = useWorkItemsByIds(membership.order);
  const displayedChildren = useWorkItemsByIds(
    task ? membership.children[task.id] ?? NO_CHILD_IDS : NO_CHILD_IDS,
  );
  const projectContextId = selectedProjectId ?? task?.project_id ?? null;
  const modules = useModulesQuery(projectContextId).data ?? EMPTY_MODULES;
  const projects = useProjectsQuery().data ?? EMPTY_PROJECTS;
  const states = useCachedStates(task?.project_id ?? null);
  const issueTypes = useIssueTypesQuery(task?.project_id ?? null).data ?? [];
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

  const [sidebarVisible, setSidebarVisible] = useState(readSidebarVisible);
  const toggleSidebar = () =>
    setSidebarVisible((v) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1");
      } catch {
        /* ignore unavailable storage */
      }
      return !v;
    });

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
    await deleteWorkItem(task.id);
    queryClient.removeQueries({ queryKey: queryKeys.workItems.byId(task.id) });
    if (selectedProjectId && selectedModuleId) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.byModule(selectedProjectId, selectedModuleId),
        exact: true,
      });
    }
  };

  return (
    <div
      className={`grid h-full overflow-hidden ${
        sidebarVisible ? "grid-cols-[1fr_260px]" : "grid-cols-[1fr]"
      }`}
    >
      {/* Left content column */}
      <div className="overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <Breadcrumb
            project={project}
            epic={epic}
            onProjectClick={goProject}
            onEpicClick={goEpic}
          />
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={sidebarVisible}
            aria-label={sidebarVisible ? "Hide details panel" : "Show details panel"}
            title={sidebarVisible ? "Hide details panel" : "Show details panel"}
            data-testid="issue-sidebar-toggle"
            className={`flex-none p-1 transition-colors hover:bg-pane-title hover:text-text-primary ${
              sidebarVisible ? "text-text-secondary" : "text-focus-accent"
            }`}
          >
            <IconPanelLeft size={15} style={{ transform: "scaleX(-1)" }} />
          </button>
        </div>

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

        <div className="mt-4 flex items-center gap-3" data-testid="status-row">
          <LaunchAgentAction issueId={task.id} />
          <StatePicker
            projectId={task.project_id}
            value={task.state}
            saving={Boolean(saving.state_id)}
            onChange={(state) =>
              setState.mutate(
                { id: task.id, state },
                { onError: reportMutationError },
              )
            }
          />
          <RunNowAction
            item={task}
            moduleId={epic?.id ?? null}
            states={states}
            issueTypes={issueTypes}
          />
          <SubtreeRunActions task={task} moduleId={epic?.id ?? null} />
        </div>

        <div className="mt-6">
          <div className="mb-1 text-xs uppercase tracking-wider text-text-secondary">Description</div>
          <Suspense fallback={null}>
            <DescriptionEditor
              value={descriptionValue}
              onSave={(description) =>
                editDescription.mutate(
                  { id: task.id, description },
                  { onError: reportMutationError },
                )
              }
            />
          </Suspense>
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

      {sidebarVisible && (
        <IssueSidebar
          task={task}
          epic={epic}
          saving={saving}
          blockedByChips={blockedByChips}
          blocksChips={blocksChips}
          items={items}
          setIssueType={(issueType) =>
            changeType.mutate(
              { id: task.id, issueType },
              { onError: reportMutationError },
            )
          }
          setParent={(parentId) =>
            setParent.mutate(
              { id: task.id, parentId },
              { onError: reportMutationError },
            )
          }
          addBlocker={addBlocker}
          removeBlocker={removeBlocker}
          goEpic={goEpic}
          actions={
            <IssueActionsMenu
              hasSubtasks={task.sub_issues_count > 0}
              onDelete={onDelete}
            />
          }
        />
      )}
    </div>
  );
}
