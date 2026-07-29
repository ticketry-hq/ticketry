import { act, renderHook } from "@testing-library/react";
import type { DragEvent as ReactDragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  useAxisDragAndDrop,
  type AxisDragAndDropController,
  type DragAxis,
  type DragPayloadCodec,
} from "./useAxisDragAndDrop";

interface Payload {
  readonly id: string;
}

const codec: DragPayloadCodec<Payload> = {
  type: "application/x-axis-drag-test",
  serialize: JSON.stringify,
  deserialize(serialized) {
    try {
      const value: unknown = JSON.parse(serialized);
      if (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string"
      ) {
        return { id: value.id };
      }
    } catch {
      // Rejected below.
    }
    return null;
  },
};

class DataTransferStub {
  dropEffect = "none";
  effectAllowed = "uninitialized";
  private readonly data = new Map<string, string>();

  get types() {
    return [...this.data.keys()];
  }

  getData(type: string) {
    return this.data.get(type) ?? "";
  }

  setData(type: string, value: string) {
    this.data.set(type, value);
  }
}

function dragEvent(
  dataTransfer: DataTransferStub,
  options: {
    clientX?: number;
    clientY?: number;
    currentTarget?: HTMLElement;
    relatedTarget?: EventTarget | null;
  } = {},
): ReactDragEvent<HTMLElement> {
  const currentTarget = options.currentTarget ?? document.createElement("div");
  return {
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    currentTarget,
    dataTransfer,
    preventDefault: vi.fn(),
    relatedTarget: options.relatedTarget ?? null,
  } as unknown as ReactDragEvent<HTMLElement>;
}

function startDrag(
  result: { current: AxisDragAndDropController<Payload, string> },
  payload: Payload = { id: "source" },
) {
  const transfer = new DataTransferStub();
  act(() => {
    result.current
      .getDragSourceProps(payload)
      .onDragStart(dragEvent(transfer));
  });
  return transfer;
}

function renderController(
  axis: DragAxis,
  options: { disabled?: boolean; onDrop?: ReturnType<typeof vi.fn> } = {},
) {
  return renderHook(
    ({ disabled }) =>
      useAxisDragAndDrop<Payload, string>({
        axis,
        codec,
        disabled,
        onDrop: options.onDrop,
      }),
    { initialProps: { disabled: options.disabled ?? false } },
  );
}

describe("useAxisDragAndDrop", () => {
  it.each([
    {
      axis: "vertical" as const,
      near: { clientX: 95, clientY: 24 },
      far: { clientX: 5, clientY: 76 },
    },
    {
      axis: "horizontal" as const,
      near: { clientX: 24, clientY: 95 },
      far: { clientX: 76, clientY: 5 },
    },
  ])("resolves near and far along the $axis axis", ({ axis, near, far }) => {
    const { result } = renderController(axis);
    const transfer = startDrag(result);
    const target = document.createElement("div");
    target.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 100,
        height: 100,
      }) as DOMRect;
    const props = result.current.getDropTargetProps("target");

    act(() =>
      props.onDragOver(
        dragEvent(transfer, { ...near, currentTarget: target }),
      ),
    );
    expect(result.current).toMatchObject({
      targetId: "target",
      intent: "near",
    });

    act(() =>
      props.onDragOver(
        dragEvent(transfer, { ...far, currentTarget: target }),
      ),
    );
    expect(result.current).toMatchObject({
      targetId: "target",
      intent: "far",
    });
  });

  it("rejects foreign and malformed payloads", () => {
    const { result } = renderController("vertical");
    const target = result.current.getDropTargetProps("target");
    const foreign = new DataTransferStub();
    foreign.setData("text/plain", JSON.stringify({ id: "foreign" }));

    act(() => target.onDragOver(dragEvent(foreign)));
    expect(result.current.targetId).toBeNull();

    const malformed = startDrag(result);
    malformed.setData(codec.type, "not-json");
    act(() => target.onDragOver(dragEvent(malformed)));
    expect(result.current.targetId).toBeNull();
  });

  it("does not start or resolve a drag while disabled", () => {
    const { result } = renderController("vertical", { disabled: true });
    const transfer = new DataTransferStub();
    const sourceEvent = dragEvent(transfer);

    act(() =>
      result.current
        .getDragSourceProps({ id: "source" })
        .onDragStart(sourceEvent),
    );
    expect(sourceEvent.preventDefault).toHaveBeenCalledOnce();
    expect(result.current.payload).toBeNull();
    expect(result.current.getDragSourceProps({ id: "other" }).draggable).toBe(
      false,
    );

    act(() =>
      result.current
        .getDropTargetProps("target")
        .onDragOver(dragEvent(transfer)),
    );
    expect(result.current.targetId).toBeNull();
  });

  it("clears target and intent on drop", () => {
    const onDrop = vi.fn();
    const { result } = renderController("vertical", { onDrop });
    const transfer = startDrag(result);
    const target = document.createElement("div");
    target.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 100, height: 100 }) as DOMRect;
    const props = result.current.getDropTargetProps("target");
    act(() =>
      props.onDragOver(
        dragEvent(transfer, { clientY: 25, currentTarget: target }),
      ),
    );

    act(() => props.onDrop(dragEvent(transfer, { currentTarget: target })));

    expect(onDrop).toHaveBeenCalledWith(
      { id: "source" },
      { targetId: "target", intent: "near" },
      expect.anything(),
    );
    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it("clears target and intent when a drag is cancelled", () => {
    const { result } = renderController("vertical");
    const transfer = startDrag(result);
    const sourceProps = result.current.getDragSourceProps({ id: "source" });
    const targetProps = result.current.getDropTargetProps("target");
    act(() => targetProps.onDragOver(dragEvent(transfer)));

    act(() => sourceProps.onDragEnd(dragEvent(transfer)));

    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it("clears target and intent on escape", () => {
    const { result } = renderController("vertical");
    const transfer = startDrag(result);
    act(() =>
      result.current
        .getDropTargetProps("target")
        .onDragOver(dragEvent(transfer)),
    );

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );

    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it("clears target and intent when the drag leaves the surface", () => {
    const { result } = renderController("vertical");
    const transfer = startDrag(result);
    act(() =>
      result.current
        .getDropTargetProps("target")
        .onDragOver(dragEvent(transfer)),
    );

    act(() => document.dispatchEvent(new Event("dragleave", { bubbles: true })));

    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it(
    "keeps prop-getter and returned prop identities stable across hover changes",
    () => {
      const payload = { id: "source" };
      const { result } = renderController("vertical");
      const getSource = result.current.getDragSourceProps;
      const getTarget = result.current.getDropTargetProps;
      const sourceProps = getSource(payload);
      const targetProps = getTarget("target");
      const transfer = startDrag(result, payload);

      act(() => targetProps.onDragOver(dragEvent(transfer)));

      expect(result.current.getDragSourceProps).toBe(getSource);
      expect(result.current.getDropTargetProps).toBe(getTarget);
      expect(result.current.getDragSourceProps({ id: "source" })).toBe(
        sourceProps,
      );
      expect(result.current.getDropTargetProps("target")).toBe(targetProps);
    },
  );
});
