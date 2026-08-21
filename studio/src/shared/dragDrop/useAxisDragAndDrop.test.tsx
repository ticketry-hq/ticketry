import { act, renderHook } from "@testing-library/react";
import type { DragEvent as ReactDragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  transientDocumentDragLeave,
  transientDocumentDragLeaveTargets,
} from "../../test/moduleDragGestures";
import {
  useAxisDragAndDrop,
  type AxisDragAndDropController,
  type DragAxis,
  type DragPayloadCodec,
  type ResolvedDrop,
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
  options: {
    disabled?: boolean;
    onDrop?: (
      payload: Payload,
      resolved: ResolvedDrop<string>,
      event: ReactDragEvent<HTMLElement> | DragEvent,
    ) => void;
  } = {},
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

const TARGET_LENGTH = 100;
const mountedTargets: HTMLElement[] = [];

/**
 * Lay three drop targets out along the axis and register them, so placement can
 * be resolved for pointers that never enter a target's cross-axis bounds.
 */
function mountTargets(
  result: { current: AxisDragAndDropController<Payload, string> },
  axis: DragAxis,
  ids: string[],
): void {
  ids.forEach((id, index) => {
    const element = document.createElement("div");
    const offset = index * TARGET_LENGTH;
    element.getBoundingClientRect = () =>
      (axis === "vertical"
        ? { top: offset, left: 0, width: 200, height: TARGET_LENGTH }
        : { top: 0, left: offset, width: TARGET_LENGTH, height: 40 }) as DOMRect;
    document.body.append(element);
    mountedTargets.push(element);
    act(() => result.current.getDropTargetProps(id).ref(element));
  });
}

/** A drag event dispatched away from every target, as the document sees it. */
function dispatchDocumentDrag(
  type: "dragover" | "drop",
  dataTransfer: DataTransferStub,
  point: { clientX: number; clientY: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: point.clientX },
    clientY: { value: point.clientY },
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

describe("useAxisDragAndDrop", () => {
  afterEach(() => {
    mountedTargets.splice(0).forEach((element) => element.remove());
  });

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

  it.each([
    {
      axis: "vertical" as const,
      // Beside the list, level with the second row's top half.
      outside: { clientX: 900, clientY: 120 },
      beyond: { clientX: 900, clientY: 900 },
    },
    {
      axis: "horizontal" as const,
      // Above the strip, level with the second tab's left half.
      outside: { clientX: 120, clientY: -80 },
      beyond: { clientX: 900, clientY: -80 },
    },
  ])(
    "keeps targeting on the $axis axis outside the target's cross-axis bounds",
    ({ axis, outside, beyond }) => {
      const onDrop = vi.fn();
      const { result } = renderController(axis, { onDrop });
      mountTargets(result, axis, ["first", "second", "third"]);
      const transfer = startDrag(result);

      const over = dispatchDocumentDrag("dragover", transfer, outside);

      // The seam is promised, and the browser is told the release is allowed.
      expect(result.current).toMatchObject({
        targetId: "second",
        intent: "near",
      });
      expect(over.defaultPrevented).toBe(true);

      // Past every target along the axis is genuinely away from the surface.
      dispatchDocumentDrag("dragover", transfer, beyond);
      expect(result.current).toMatchObject({
        payload: { id: "source" },
        targetId: null,
        intent: null,
      });

      dispatchDocumentDrag("dragover", transfer, outside);
      dispatchDocumentDrag("drop", transfer, outside);

      expect(onDrop).toHaveBeenCalledWith(
        { id: "source" },
        { targetId: "second", intent: "near" },
        expect.anything(),
      );
      expect(result.current).toMatchObject({
        payload: null,
        targetId: null,
        intent: null,
      });
    },
  );

  it("leaves a release beyond every target unwritten", () => {
    const onDrop = vi.fn();
    const { result } = renderController("horizontal", { onDrop });
    mountTargets(result, "horizontal", ["first", "second"]);
    const transfer = startDrag(result);

    dispatchDocumentDrag("dragover", transfer, { clientX: 900, clientY: -80 });
    dispatchDocumentDrag("drop", transfer, { clientX: 900, clientY: -80 });

    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it.each(transientDocumentDragLeaveTargets)(
    "resumes the same typed drag after a transient %s leave",
    (leaveTarget) => {
      const onDrop = vi.fn();
      const { result } = renderController("horizontal", { onDrop });
      mountTargets(result, "horizontal", ["first", "second"]);
      const payload = { id: "original" };
      const transfer = startDrag(result, payload);

      dispatchDocumentDrag("dragover", transfer, {
        clientX: 120,
        clientY: -80,
      });
      expect(result.current).toMatchObject({
        payload,
        targetId: "second",
        intent: "near",
      });

      transientDocumentDragLeave(transfer, leaveTarget);
      expect(result.current).toMatchObject({
        payload,
        targetId: null,
        intent: null,
      });

      dispatchDocumentDrag("dragover", transfer, {
        clientX: 180,
        clientY: -80,
      });
      dispatchDocumentDrag("drop", transfer, {
        clientX: 180,
        clientY: -80,
      });

      expect(onDrop).toHaveBeenCalledOnce();
      expect(onDrop).toHaveBeenCalledWith(
        payload,
        { targetId: "second", intent: "far" },
        expect.anything(),
      );
      expect(result.current).toMatchObject({
        payload: null,
        targetId: null,
        intent: null,
      });
    },
  );

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

  it("keeps source drag end authoritative after a transient leave", () => {
    const { result } = renderController("vertical");
    const transfer = startDrag(result);
    const sourceProps = result.current.getDragSourceProps({ id: "source" });
    const targetProps = result.current.getDropTargetProps("target");
    act(() => targetProps.onDragOver(dragEvent(transfer)));
    transientDocumentDragLeave(transfer);

    act(() => sourceProps.onDragEnd(dragEvent(transfer)));

    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it("keeps Escape authoritative after a transient leave", () => {
    const { result } = renderController("vertical");
    const transfer = startDrag(result);
    act(() =>
      result.current
        .getDropTargetProps("target")
        .onDragOver(dragEvent(transfer)),
    );
    transientDocumentDragLeave(transfer);

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );

    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it("keeps disablement authoritative after a transient leave", () => {
    const { result, rerender } = renderController("vertical");
    const transfer = startDrag(result);
    act(() =>
      result.current
        .getDropTargetProps("target")
        .onDragOver(dragEvent(transfer)),
    );
    transientDocumentDragLeave(transfer);

    rerender({ disabled: true });

    expect(result.current).toMatchObject({
      payload: null,
      targetId: null,
      intent: null,
    });
  });

  it("keeps teardown authoritative after a transient leave", () => {
    const onDrop = vi.fn();
    const { result, unmount } = renderController("vertical", { onDrop });
    const transfer = startDrag(result);
    const targetProps = result.current.getDropTargetProps("target");
    act(() => targetProps.onDragOver(dragEvent(transfer)));
    transientDocumentDragLeave(transfer);
    act(() => targetProps.onDragOver(dragEvent(transfer)));

    unmount();
    act(() => targetProps.onDrop(dragEvent(transfer)));

    expect(onDrop).not.toHaveBeenCalled();
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
