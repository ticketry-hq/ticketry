import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CompleteSprintDialog from "../features/sprints/CompleteSprintDialog";
import StartSprintDialog from "../features/sprints/StartSprintDialog";
import NewSprintButton from "../features/sprints/NewSprintButton";
import { sprint } from "../features/planning-graph/testGraph";

describe("sprint lifecycle dialogs acceptance", () => {
  it("creates a named sprint and reports its id without dates or a goal field", async () => {
    const onCreate = vi.fn(async () => "new-sprint");
    const onCreated = vi.fn();
    render(<NewSprintButton sprints={[sprint({ id: "old", name: "Sprint 3" })]} onCreate={onCreate} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
    expect(screen.getByRole("textbox", { name: "Sprint name" })).toHaveValue("Sprint 4");
    expect(screen.queryByRole("textbox", { name: /goal/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Sprint name" }), { target: { value: "  Release  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-sprint"));
    expect(onCreate).toHaveBeenCalledWith("Release");
    expect(screen.getByRole("button", { name: "New sprint" })).toBeInTheDocument();
  });
  it("starts a sprint without date or length controls and closes after success", async () => {
    const onStart = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<StartSprintDialog sprint={sprint({ id: "s", name: "Release" })} activeSprintName={null} onStart={onStart} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Start Release" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
  it("completes a sprint carrying unfinished work to a selected planned sprint", async () => {
    const onComplete = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<CompleteSprintDialog sprint={sprint({ id: "s", name: "Release", status: "active" })} done={2} total={5} plannedSprints={[sprint({ id: "next", name: "Next release" })]} onComplete={onComplete} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Move 3 unfinished items to" }), { target: { value: "next" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith("next");
  });
  it("keeps creation open on server rejection so the name can be retried", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("Name is already used")).mockResolvedValueOnce("new");
    render(<NewSprintButton sprints={[]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is already used");
    expect(screen.getByRole("textbox", { name: "Sprint name" })).toHaveValue("Sprint 1");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("button", { name: "New sprint" });
  });

  it("prevents starting while another sprint is active", () => {
    const onStart = vi.fn(async () => true);
    render(<StartSprintDialog sprint={sprint({ id: "s" })} activeSprintName="Existing sprint" onStart={onStart} onClose={() => {}} />);
    expect(screen.getByText("Complete Existing sprint before starting another sprint.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start sprint" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("shows a rejected start and allows a retry without closing", async () => {
    const onClose = vi.fn();
    const onStart = vi.fn().mockRejectedValueOnce(new Error("Another sprint became active")).mockResolvedValueOnce(true);
    render(<StartSprintDialog sprint={sprint({ id: "s" })} activeSprintName={null} onStart={onStart} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another sprint became active");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it.each([0, 2])("uses the backlog destination with %i unfinished items", async (unfinished) => {
    const onComplete = vi.fn(async () => true);
    render(<CompleteSprintDialog sprint={sprint({ id: "s" })} done={3} total={3 + unfinished} plannedSprints={[]} onComplete={onComplete} onClose={() => {}} />);
    if (unfinished === 0) expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(null));
  });

  it("keeps completion open during a pending request and exposes failure", async () => {
    let rejectRequest: (reason: Error) => void = () => {};
    const onComplete = vi.fn(() => new Promise<boolean>((_resolve, reject) => { rejectRequest = reject; }));
    const onClose = vi.fn();
    render(<CompleteSprintDialog sprint={sprint({ id: "s" })} done={0} total={1} plannedSprints={[]} onComplete={onComplete} onClose={onClose} />);
    const confirm = screen.getByRole("button", { name: "Complete sprint" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Completing…" })).toBeDisabled();
    rejectRequest(new Error("Carry-over failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Carry-over failed");
    expect(screen.getByRole("button", { name: "Complete sprint" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
