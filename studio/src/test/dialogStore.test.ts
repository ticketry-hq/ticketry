import { beforeEach, describe, expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";

beforeEach(() => {
  useClientStore.setState({ dialogs: [] });
});

describe("dialogStore.confirm", () => {
  it("activates a confirm dialog and resolves true when confirmed", async () => {
    const p = useClientStore.getState().confirm({
      title: "Delete issue",
      body: "gone forever",
      confirmLabel: "Delete",
      danger: true,
    });
    const active = useClientStore.getState().dialogs.at(-1)!;
    expect(active.kind).toBe("confirm");
    active.resolve(true);
    await expect(p).resolves.toBe(true);
    // Cleared after resolution.
    expect(useClientStore.getState().dialogs).toEqual([]);
  });

  it("resolves false when cancelled", async () => {
    const p = useClientStore.getState().confirm({ title: "t", body: "b" });
    useClientStore.getState().dialogs.at(-1)!.resolve(false);
    await expect(p).resolves.toBe(false);
  });
});

describe("dialogStore.reassign", () => {
  it("resolves a chosen target", async () => {
    const p = useClientStore.getState().reassign({
      title: "Delete type",
      itemName: "Bug",
      candidates: [{ id: "t2", name: "Task" }],
    });
    const active = useClientStore.getState().dialogs.at(-1)!;
    expect(active.kind).toBe("reassign");
    (active.resolve as (v: { reassignTo?: string } | null) => void)({ reassignTo: "t2" });
    await expect(p).resolves.toEqual({ reassignTo: "t2" });
  });

  it("resolves {} for delete-only-if-unused and null for cancel", async () => {
    const p1 = useClientStore.getState().reassign({ title: "t", itemName: "x", candidates: [] });
    (useClientStore.getState().dialogs.at(-1)!.resolve as (v: unknown) => void)({});
    await expect(p1).resolves.toEqual({});

    const p2 = useClientStore.getState().reassign({ title: "t", itemName: "x", candidates: [] });
    (useClientStore.getState().dialogs.at(-1)!.resolve as (v: unknown) => void)(null);
    await expect(p2).resolves.toBeNull();
  });
});
