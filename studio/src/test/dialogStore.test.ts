import { beforeEach, describe, expect, it } from "vitest";
import { useDialogStore } from "../app/stores/dialogStore";

beforeEach(() => {
  useDialogStore.setState({ active: null });
});

describe("dialogStore.confirm", () => {
  it("activates a confirm dialog and resolves true when confirmed", async () => {
    const p = useDialogStore.getState().confirm({
      title: "Delete issue",
      body: "gone forever",
      confirmLabel: "Delete",
      danger: true,
    });
    const active = useDialogStore.getState().active!;
    expect(active.kind).toBe("confirm");
    active.resolve(true);
    await expect(p).resolves.toBe(true);
    // Cleared after resolution.
    expect(useDialogStore.getState().active).toBeNull();
  });

  it("resolves false when cancelled", async () => {
    const p = useDialogStore.getState().confirm({ title: "t", body: "b" });
    useDialogStore.getState().active!.resolve(false);
    await expect(p).resolves.toBe(false);
  });
});

describe("dialogStore.reassign", () => {
  it("resolves a chosen target", async () => {
    const p = useDialogStore.getState().reassign({
      title: "Delete type",
      itemName: "Bug",
      candidates: [{ id: "t2", name: "Task" }],
    });
    const active = useDialogStore.getState().active!;
    expect(active.kind).toBe("reassign");
    (active.resolve as (v: { reassignTo?: string } | null) => void)({ reassignTo: "t2" });
    await expect(p).resolves.toEqual({ reassignTo: "t2" });
  });

  it("resolves {} for delete-only-if-unused and null for cancel", async () => {
    const p1 = useDialogStore.getState().reassign({ title: "t", itemName: "x", candidates: [] });
    (useDialogStore.getState().active!.resolve as (v: unknown) => void)({});
    await expect(p1).resolves.toEqual({});

    const p2 = useDialogStore.getState().reassign({ title: "t", itemName: "x", candidates: [] });
    (useDialogStore.getState().active!.resolve as (v: unknown) => void)(null);
    await expect(p2).resolves.toBeNull();
  });
});
