import { Suspense, useEffect, useState, type ReactNode } from "react";
import type {
  AgentPickerPayload,
  ModuleFolderPayload,
  PromptInputPayload,
} from "../../features/agents/terminal";
import type { ParentUpdatePayload } from "../../features/studio/modals/ParentUpdate";
import { studioRuntime } from "../../runtime";
import {
  createLazyModalComponents,
  type LazyModalComponents,
} from "./lazyModalComponents";
import { ModalErrorBoundary } from "./ModalErrorBoundary";
import { useModalStore, type ModalDescriptor } from "./modalStore";

const MODAL_LABELS: Record<ModalDescriptor["type"], string> = {
  "agent-picker": "Agent picker",
  "prompt-input": "Prompt",
  "module-folder": "Module folder",
  settings: "Settings",
  "keyboard-shortcuts": "Keyboard shortcuts",
  "status-update": "Status update",
  "parent-update": "Parent update",
  "add-module": "Add module",
  "add-project": "Add project",
  "notify-user": "Notice",
};

function useRuntimeUserNotices(): void {
  const notifyUser = useModalStore((state) => state.notifyUser);
  useEffect(() => {
    const runtime = studioRuntime();
    for (const notice of runtime.startup().initialNotices) {
      notifyUser(notice);
    }
    return runtime.subscribeUserNotices(notifyUser);
  }, [notifyUser]);
}

/** Visible placeholder: a silent `null` fallback is indistinguishable from a
 *  dead button while a chunk is in flight or failing. */
function ModalLoadingFallback({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="status"
        className="border border-pane-border bg-pane-panel px-4 py-3 text-sm text-text-muted"
      >
        Loading {label}…
      </div>
    </div>
  );
}

function renderModal(
  top: ModalDescriptor,
  modals: LazyModalComponents,
): ReactNode {
  switch (top.type) {
    case "agent-picker":
      return (
        <modals.AgentPicker payload={top.payload as unknown as AgentPickerPayload} />
      );
    case "prompt-input":
      return (
        <modals.PromptInput payload={top.payload as unknown as PromptInputPayload} />
      );
    case "module-folder":
      return (
        <modals.ModuleFolder payload={top.payload as unknown as ModuleFolderPayload} />
      );
    case "settings":
      return <modals.SettingsModal />;
    case "keyboard-shortcuts":
      return <modals.KeyboardShortcutsModal />;
    case "status-update":
      return <modals.StatusUpdate />;
    case "parent-update":
      return (
        <modals.ParentUpdate
          payload={top.payload as unknown as ParentUpdatePayload | undefined}
        />
      );
    case "add-module":
      return <modals.AddModule />;
    case "add-project":
      return <modals.AddProject />;
    case "notify-user":
      return <modals.NotifyUserModal notice={top.payload} />;
  }
}

/** Renders the top Studio-reachable descriptor from the modal bus. */
export function ModalHost() {
  useRuntimeUserNotices();
  const top = useModalStore((state) => state.modalStack.at(-1));
  const [attempt, setAttempt] = useState(0);
  const [modals, setModals] = useState<LazyModalComponents>(
    createLazyModalComponents,
  );
  if (!top) return null;

  const label = MODAL_LABELS[top.type];
  return (
    <ModalErrorBoundary
      label={label}
      resetKey={`${top.type}:${attempt}`}
      onRetry={() => {
        setModals(createLazyModalComponents());
        setAttempt((value) => value + 1);
      }}
    >
      <Suspense fallback={<ModalLoadingFallback label={label} />}>
        {renderModal(top, modals)}
      </Suspense>
    </ModalErrorBoundary>
  );
}
