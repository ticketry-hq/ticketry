import type { ReactNode } from "react";
import type { PlanningSprint } from "../planning-graph";

export default function SprintCard({ sprint, done, total, action, goals, suggestions, children }: {
  sprint: PlanningSprint;
  done: number;
  total: number;
  action?: ReactNode;
  goals: ReactNode;
  suggestions: ReactNode;
  children?: ReactNode;
}) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return <section data-testid={`sprint-card-${sprint.id}`} className="border border-pane-border bg-pane-panel">
    <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
      <h2 className="min-w-0 truncate text-base font-semibold text-text-primary">{sprint.name}</h2>
      <span className="border border-pane-border px-1 text-xs text-text-secondary">{sprint.status}</span>
      <div className="ml-auto flex gap-1">{action}</div>
    </div>
    <div className="px-3 pt-2">{goals}</div>
    <div className="px-3 pt-2">{suggestions}</div>
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="h-1 flex-1 bg-pane-title" role="progressbar" aria-label={`${sprint.name} progress`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className="h-1 bg-focus-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-text-muted">{done}/{total} done</span>
    </div>
    {children && <div className="border-t border-pane-border py-1">{children}</div>}
  </section>;
}
