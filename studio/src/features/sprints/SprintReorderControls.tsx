export type SprintReorder = { sprintId: string; beforeId: string | null; afterId: string | null };

export default function SprintReorderControls({ first, last, busy, onMove }: {
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const style = "h-7 border border-pane-border px-2 text-sm text-text-secondary disabled:opacity-40";
  return <>
    <button type="button" aria-label="Move sprint earlier" title="Move sprint earlier"
      disabled={first || busy} onClick={() => onMove(-1)} className={style}>↑</button>
    <button type="button" aria-label="Move sprint later" title="Move sprint later"
      disabled={last || busy} onClick={() => onMove(1)} className={style}>↓</button>
  </>;
}
