// Persisted layout order: projects, modules, tasks, workspace.
export const DEFAULT_PANEL_LAYOUT = [18, 18, 36, 28];

export function splitWorkArea(layout: number[]): [number, number] {
  const total = layout[2] + layout[3];
  if (total <= 0) return [50, 50];

  return [(layout[2] / total) * 100, (layout[3] / total) * 100];
}

export function outerPanelLayout(
  layout: number[],
  sidebarVisible: boolean,
): number[] {
  if (!sidebarVisible) return [100];

  return [layout[0], layout[1], layout[2] + layout[3]];
}

export function mergeOuterPanelLayout(
  layout: number[],
  outer: number[],
): number[] | null {
  if (outer.length !== 3) return null;

  const [tasksRatio, workspaceRatio] = splitWorkArea(layout);
  return [
    outer[0],
    outer[1],
    outer[2] * (tasksRatio / 100),
    outer[2] * (workspaceRatio / 100),
  ];
}

export function mergeWorkAreaLayout(
  layout: number[],
  workArea: number[],
): number[] | null {
  if (workArea.length !== 2) return null;

  const visibleTotal = Math.max(0, 100 - layout[0] - layout[1]);
  const workAreaTotal = workArea[0] + workArea[1];
  if (visibleTotal <= 0 || workAreaTotal <= 0) return null;

  return [
    layout[0],
    layout[1],
    visibleTotal * (workArea[0] / workAreaTotal),
    visibleTotal * (workArea[1] / workAreaTotal),
  ];
}
