import { create } from "zustand";
import { useUIStore } from "../../features/studio/stores/uiStore";
import { DEFAULT_PANEL_LAYOUT } from "../studio/layout/layoutMath";

export type OnboardingTourStep =
  | "inactive"
  | "projects-pane"
  | "module-create"
  | "story-create"
  | "handoff";

export function onboardingTourRequiresModules(step: OnboardingTourStep): boolean {
  return step === "module-create" || step === "story-create";
}

interface OnboardingTourState {
  step: OnboardingTourStep;
  projectId: string | null;
  moduleId: string | null;
  storyId: string | null;
  capturedLayout: CapturedLayout | null;
  start: (projectId: string) => void;
  showModuleCreate: () => void;
  moduleCreated: (moduleId: string) => void;
  storyCreated: (storyId: string) => void;
  reset: () => void;
}

const INACTIVE = {
  step: "inactive" as const,
  projectId: null,
  moduleId: null,
  storyId: null,
  capturedLayout: null,
};

interface CapturedLayout {
  sidebarVisible: boolean;
  panelLayout: number[] | null;
}

function copyLayout(layout: number[] | null): number[] | null {
  return layout ? [...layout] : null;
}

function restoreLayout(layout: CapturedLayout | null): void {
  if (!layout) return;
  useUIStore.setState({
    sidebarVisible: layout.sidebarVisible,
    panelLayout: copyLayout(layout.panelLayout),
  });
}

/** Run-local only by design: a refresh never resumes a half-finished tour. */
export const useOnboardingTourStore = create<OnboardingTourState>((set, get) => ({
  ...INACTIVE,
  start: (projectId) => {
    const ui = useUIStore.getState();
    const capturedLayout = get().capturedLayout ?? {
      sidebarVisible: ui.sidebarVisible,
      panelLayout: copyLayout(ui.panelLayout),
    };

    // This is deliberately transient. The user's durable layout preferences
    // remain untouched while the tour temporarily makes every anchor visible.
    useUIStore.setState({
      sidebarVisible: true,
      panelLayout: [...DEFAULT_PANEL_LAYOUT],
    });
    set({ ...INACTIVE, step: "projects-pane", projectId, capturedLayout });
  },
  showModuleCreate: () => set({ step: "module-create" }),
  moduleCreated: (moduleId) => set({ step: "story-create", moduleId }),
  storyCreated: (storyId) =>
    set((state) =>
      state.step === "story-create"
        ? { step: "handoff", storyId }
        : state,
    ),
  reset: () => {
    restoreLayout(get().capturedLayout);
    set(INACTIVE);
  },
}));
