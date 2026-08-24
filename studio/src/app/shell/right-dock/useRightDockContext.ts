import { useStudioStore } from "../../../features/projects/store";
import { useClientStore } from "../../../state/clientStore";
import type { RightDockContext } from "./types";

export function useRightDockContext(): RightDockContext {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  return { projectId, moduleId };
}
