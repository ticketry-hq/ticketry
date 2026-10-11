import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { usePlanWorkItem, usePlanWritePending } from "../features/work-items";
import { flushInput, incomingButton, mountMovePlan } from "./planMovePolicyFixture";

afterEach(() => vi.useRealTimers());

function CompetingAssignmentView() {
  const assign = usePlanWorkItem();
  const pending = usePlanWritePending();
  return <button disabled={pending("story")} onClick={() => void assign("story", null)}>Return delivery from another view</button>;
}

it("[overhaul-754] move Undo expires after five unheld seconds and preserves remaining time across focus and hover", async () => {
  mountMovePlan();
  const incoming = await incomingButton();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  fireEvent.click(incoming);
  await flushInput();
  const undo = screen.getByRole("button", { name: /Undo .+-1 move/ });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  fireEvent.focus(undo);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(undo).toBeVisible();
  fireEvent.mouseEnter(undo);
  fireEvent.blur(undo);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(undo).toBeVisible();
  fireEvent.mouseLeave(undo);
  await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
  expect(undo).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.queryByRole("button", { name: /Undo .+-1 move/ })).not.toBeInTheDocument();
});

it.each(["Plan", "other view"])("[overhaul-755] competing mounted views share a synchronous per-item write guard (%s first)", async (firstView) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const plan = mountMovePlan({ extraControls: <CompetingAssignmentView />, move: () => pending });
  const incoming = await incomingButton();
  const otherView = screen.getByRole("button", { name: "Return delivery from another view" });
  act(() => {
    fireEvent.click(firstView === "Plan" ? incoming : otherView);
    fireEvent.click(firstView === "Plan" ? otherView : incoming);
  });
  await flushInput();
  const destination = firstView === "Plan" ? "sprint" : null;
  expect(plan.writes).toEqual([{ id: "story", sprintId: destination }]);
  expect(otherView).toBeDisabled();
  await act(async () => { release(); await pending; });
  await waitFor(() => expect(otherView).toBeEnabled());
  expect(screen.queryByRole("button", { name: /Retry moving/ })).not.toBeInTheDocument();
  fireEvent.click(firstView === "Plan" ? otherView : screen.getByRole("button", { name: /Plan .+-1 into sprint/ }));
  await waitFor(() => expect(plan.writes).toEqual([{ id: "story", sprintId: destination }, { id: "story", sprintId: firstView === "Plan" ? null : "sprint" }]));
});

it("[overhaul-756] reopening a Plan visit isolates its predecessor's late move settlement", async () => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const plan = mountMovePlan({ move: () => pending });
  fireEvent.click(await incomingButton());
  await waitFor(() => expect(plan.writes).toHaveLength(1));
  act(() => usePlanWorkspace.setState({ generation: usePlanWorkspace.getState().generation + 1 }));
  const outgoing = await screen.findByRole("button", { name: /Return .+-1 to backlog/ });
  expect(outgoing).toBeDisabled();
  await act(async () => { release(); await pending; });
  await waitFor(() => expect(screen.getByRole("button", { name: /Return .+-1 to backlog/ })).toBeEnabled());
  expect(screen.queryByRole("button", { name: /Undo .+-1 move/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Return .+-1 to backlog/ }));
  await waitFor(() => expect(plan.writes).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("button", { name: /Undo .+-1 move/ })).toBeEnabled());
  expect(plan.writes).toEqual([{ id: "story", sprintId: "sprint" }, { id: "story", sprintId: null }]);
});

it("[overhaul-757] failed items keep independent Retry controls and an older success cannot replace the newest Undo", async () => {
  const attempts = new Map<string, number>();
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const plan = mountMovePlan({ extraStories: [{ id: "other", name: "Other delivery" }], move: ({ id }) => {
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    if (attempt === 1) return Promise.reject(new Error("Assignment rejected"));
    return id === "story" ? first : second;
  } });
  fireEvent.click(await incomingButton());
  const firstRetry = await screen.findByRole("button", { name: /Retry moving .+-1 to Release/ });
  fireEvent.click(screen.getByRole("button", { name: /Plan .+-2 into sprint/ }));
  const secondRetry = await screen.findByRole("button", { name: /Retry moving .+-2 to Release/ });
  expect(firstRetry).toBeEnabled();
  expect(secondRetry).toBeEnabled();
  fireEvent.click(firstRetry);
  await waitFor(() => expect(screen.queryByRole("button", { name: /Retry moving .+-1 to Release/ })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /Retry moving .+-2 to Release/ })).toBeEnabled();
  fireEvent.click(secondRetry);
  await act(async () => { releaseSecond(); await second; });
  await screen.findByRole("button", { name: /Undo .+-2 move/ });
  await act(async () => { releaseFirst(); await first; });
  await waitFor(() => expect(screen.getByRole("button", { name: /Return .+-1 to backlog/ })).toBeEnabled());
  expect(screen.getByRole("button", { name: /Undo .+-2 move/ })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /Undo .+-1 move/ })).not.toBeInTheDocument();
  expect(plan.writes).toEqual([
    { id: "story", sprintId: "sprint" }, { id: "other", sprintId: "sprint" },
    { id: "story", sprintId: "sprint" }, { id: "other", sprintId: "sprint" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: /Undo .+-2 move/ }));
  await waitFor(() => expect(plan.writes).toHaveLength(5));
  expect(plan.writes[4]).toEqual({ id: "other", sprintId: null });
  expect(screen.getByRole("button", { name: /Return .+-1 to backlog/ })).toBeEnabled();
});

it("[overhaul-784] replacing Undo starts a fresh expiry and the previous timer cannot remove the latest move", async () => {
  mountMovePlan({ extraStories: [{ id: "other", name: "Other delivery" }] });
  const incoming = await incomingButton();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  fireEvent.click(incoming);
  await flushInput();
  expect(screen.getByRole("button", { name: /Undo .+-1 move/ })).toBeEnabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  fireEvent.click(screen.getByRole("button", { name: /Plan .+-2 into sprint/ }));
  await flushInput();
  const newest = screen.getByRole("button", { name: /Undo .+-2 move/ });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(newest).toBeEnabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
  expect(newest).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.queryByRole("button", { name: /Undo .+-2 move/ })).not.toBeInTheDocument();
});

it("[overhaul-785] a failure keeps its Retry through delayed assignment rollback and dismisses independently", async () => {
  const plan = mountMovePlan({ extraStories: [{ id: "other", name: "Other delivery" }], move: async ({ id }) => {
    plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems,
      nodes: graph.workItems.nodes.map((item) => item.id === id ? { ...item, sprintId: "sprint" } : item) } }));
    throw new Error("Assignment rejected before rollback arrives");
  } });
  fireEvent.click(await incomingButton());
  await flushInput();
  expect(screen.queryByRole("button", { name: /Retry moving .+-1 to Release/ })).not.toBeInTheDocument();
  act(() => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems,
    nodes: graph.workItems.nodes.map((item) => item.id === "story" ? { ...item, sprintId: null } : item) } })));
  expect(await screen.findByRole("button", { name: /Retry moving .+-1 to Release/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /Plan .+-2 into sprint/ }));
  await flushInput();
  act(() => plan.change((graph) => ({ ...graph, workItems: { ...graph.workItems,
    nodes: graph.workItems.nodes.map((item) => ({ ...item, sprintId: null })) } })));
  expect(await screen.findByRole("button", { name: /Retry moving .+-2 to Release/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /Dismiss .+-1 failure/ }));
  expect(screen.queryByRole("button", { name: /Retry moving .+-1 to Release/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Retry moving .+-2 to Release/ })).toBeEnabled();
  expect(plan.writes).toHaveLength(2);
});
