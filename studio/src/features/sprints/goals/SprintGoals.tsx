import { useState } from "react";
import { useSprintGoals } from "./useSprintGoals";

export default function SprintGoals({ sprintId, completed }: { sprintId: string; completed: boolean }) {
  const goals = useSprintGoals(sprintId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  async function add() {
    const text = draft.trim();
    if (!text || goals.busy || completed) return;
    setFailure(null);
    try { await goals.createGoal(text); setDraft(""); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Could not add goal."); }
  }
  async function remove(id: string) {
    if (goals.busy || completed) return;
    setFailure(null);
    try { await goals.deleteGoal(id); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Could not remove goal."); }
  }
  return <section aria-label="Sprint goals" className="px-3 py-2 text-sm">
    {goals.loading && <p role="status">Loading goals…</p>}
    <ol className="space-y-1">{goals.goals.map((goal) => <li key={goal.id} className="flex items-center gap-2">
      <span className="font-mono text-xs text-text-muted">G{goal.position}</span>
      <span className="flex-1 text-text-secondary">{goal.text}</span>
      {!completed && <button type="button" disabled={goals.busy} aria-label={`Remove goal: ${goal.text}`}
        onClick={() => void remove(goal.id)} className="px-1 text-text-muted">×</button>}
    </li>)}</ol>
    {!completed && (adding ? <input autoFocus aria-label="New sprint goal" value={draft}
      disabled={goals.busy || goals.loading || Boolean(goals.error)} placeholder="Type a goal, then press Enter"
      onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void add(); }
        if (event.key === "Escape" && !goals.busy) { event.preventDefault(); event.stopPropagation(); setDraft(""); setAdding(false); setFailure(null); }
      }} className="mt-2 w-full border border-pane-border bg-pane-panel px-2 py-1 text-text-primary" />
      : <button type="button" disabled={goals.loading || Boolean(goals.error)} onClick={() => setAdding(true)}
        className="mt-2 text-xs text-text-muted">+ Goal</button>)}
    {(failure || goals.error) && <p role="alert" className="mt-1 text-xs text-lifecycle-danger">{failure || goals.error}</p>}
    {goals.error && <button type="button" onClick={() => { void goals.refetch().catch(() => {}); }}>Retry goals</button>}
  </section>;
}
