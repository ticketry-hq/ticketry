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
  projectsEnabled = true,
): number[] {
  if (!sidebarVisible) return [100];

  if (projectsEnabled) {
    return [layout[0], layout[1], layout[2] + layout[3]];
  }

  const visibleTotal = layout[1] + layout[2] + layout[3];
  if (visibleTotal <= 0) return [50, 50];
  return [
    (layout[1] / visibleTotal) * 100,
    ((layout[2] + layout[3]) / visibleTotal) * 100,
  ];
}

export function mergeOuterPanelLayout(
  layout: number[],
  outer: number[],
  projectsEnabled = true,
): number[] | null {
  const expectedLength = projectsEnabled ? 3 : 2;
  if (outer.length !== expectedLength) return null;

  const [tasksRatio, workspaceRatio] = splitWorkArea(layout);
  const availableTotal = projectsEnabled ? 100 : Math.max(0, 100 - layout[0]);
  const moduleSize = projectsEnabled
    ? outer[1]
    : outer[0] * (availableTotal / 100);
  const workAreaSize = outer.at(-1)! * (availableTotal / 100);
  return [
    projectsEnabled ? outer[0] : layout[0],
    moduleSize,
    workAreaSize * (tasksRatio / 100),
    workAreaSize * (workspaceRatio / 100),
  ];
}

export function mergeWorkAreaLayout(
  layout: number[],
  workArea: number[],
  _projectsEnabled = true,
): number[] | null {
  if (workArea.length !== 2) return null;

  const sidebarTotal = layout[0] + layout[1];
  const visibleTotal = Math.max(0, 100 - sidebarTotal);
  const workAreaTotal = workArea[0] + workArea[1];
  if (visibleTotal <= 0 || workAreaTotal <= 0) return null;

  return [
    layout[0],
    layout[1],
    visibleTotal * (workArea[0] / workAreaTotal),
    visibleTotal * (workArea[1] / workAreaTotal),
  ];
}
