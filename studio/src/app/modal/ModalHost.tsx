import { lazy, Suspense } from "react";
import type {
  AgentPickerPayload,
  ModuleFolderPayload,
  PromptInputPayload,
} from "../../features/agents/terminal";
import type { ParentUpdatePayload } from "../../features/studio/modals/ParentUpdate";
import { useModalStore } from "./modalStore";

const AgentPicker = lazy(async () => ({
  default: (await import("../../features/agents/terminal/AgentPicker")).AgentPicker,
}));
const PromptInput = lazy(async () => ({
  default: (await import("../../features/agents/terminal/PromptInput")).PromptInput,
}));
const ModuleFolder = lazy(async () => ({
  default: (await import("../../features/agents/terminal/ModuleFolder")).ModuleFolder,
}));
const SettingsModal = lazy(async () => ({
  default: (await import("../../features/studio/modals/SettingsModal")).SettingsModal,
}));
const KeyboardShortcutsModal = lazy(async () => ({
  default: (
    await import("../../features/studio/modals/KeyboardShortcutsModal")
  ).KeyboardShortcutsModal,
}));
const StatusUpdate = lazy(async () => ({
  default: (await import("../../features/studio/modals/StatusUpdate")).StatusUpdate,
}));
const ParentUpdate = lazy(async () => ({
  default: (await import("../../features/studio/modals/ParentUpdate")).ParentUpdate,
}));
const AddModule = lazy(async () => ({
  default: (await import("../../features/studio/modals/AddModule")).AddModule,
}));
const AddProject = lazy(async () => ({
  default: (await import("../../features/studio/modals/AddProject")).AddProject,
}));

/** Renders the top Studio-reachable descriptor from the modal bus. */
export function ModalHost() {
  const top = useModalStore((state) =>
    state.modalStack.at(-1),
  );
  if (!top) return null;

  switch (top.type) {
    case "agent-picker":
      return (
        <Suspense fallback={null}>
          <AgentPicker payload={top.payload as unknown as AgentPickerPayload} />
        </Suspense>
      );
    case "prompt-input":
      return (
        <Suspense fallback={null}>
          <PromptInput payload={top.payload as unknown as PromptInputPayload} />
        </Suspense>
      );
    case "module-folder":
      return (
        <Suspense fallback={null}>
          <ModuleFolder payload={top.payload as unknown as ModuleFolderPayload} />
        </Suspense>
      );
    case "settings":
      return (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      );
    case "keyboard-shortcuts":
      return (
        <Suspense fallback={null}>
          <KeyboardShortcutsModal />
        </Suspense>
      );
    case "status-update":
      return (
        <Suspense fallback={null}>
          <StatusUpdate />
        </Suspense>
      );
    case "parent-update":
      return (
        <Suspense fallback={null}>
          <ParentUpdate
            payload={top.payload as unknown as ParentUpdatePayload | undefined}
          />
        </Suspense>
      );
    case "add-module":
      return (
        <Suspense fallback={null}>
          <AddModule />
        </Suspense>
      );
    case "add-project":
      return (
        <Suspense fallback={null}>
          <AddProject />
        </Suspense>
      );
  }
}
