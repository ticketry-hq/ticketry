// Persisted layout order: modules, tasks, workspace. There is one installation
// project, so the sidebar holds the modules pane alone.
export const DEFAULT_PANEL_LAYOUT = [18, 44, 38];

export function splitWorkArea(layout: number[]): [number, number] {
  const total = layout[1] + layout[2];
  if (total <= 0) return [50, 50];

  return [(layout[1] / total) * 100, (layout[2] / total) * 100];
}

export function outerPanelLayout(
  layout: number[],
  sidebarVisible: boolean,
): number[] {
  if (!sidebarVisible) return [100];

  const total = layout[0] + layout[1] + layout[2];
  if (total <= 0) return [50, 50];
  return [(layout[0] / total) * 100, ((layout[1] + layout[2]) / total) * 100];
}

export function mergeOuterPanelLayout(
  layout: number[],
  outer: number[],
): number[] | null {
  if (outer.length !== 2) return null;
  const [tasksRatio, workspaceRatio] = splitWorkArea(layout);
  const workAreaSize = outer[1];
  return [
    outer[0],
    workAreaSize * (tasksRatio / 100),
    workAreaSize * (workspaceRatio / 100),
  ];
}

export function mergeWorkAreaLayout(
  layout: number[],
  workArea: number[],
): number[] | null {
  if (workArea.length !== 2) return null;

  const visibleTotal = Math.max(0, 100 - layout[0]);
  const workAreaTotal = workArea[0] + workArea[1];
  if (visibleTotal <= 0 || workAreaTotal <= 0) return null;

  return [
    layout[0],
    visibleTotal * (workArea[0] / workAreaTotal),
    visibleTotal * (workArea[1] / workAreaTotal),
  ];
}
