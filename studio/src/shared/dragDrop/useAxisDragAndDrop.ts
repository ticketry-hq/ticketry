import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type DragEventHandler,
} from "react";

import {
  intentWithinSpan,
  pointerAlongAxis,
  resolvePlacementAlongAxis,
  spanAlongAxis,
  type DragAxis,
  type DropIntent,
} from "./axisPlacement";

export type { DragAxis, DropIntent };

export interface DragPayloadCodec<Payload> {
  readonly type: string;
  serialize(payload: Payload): string;
  deserialize(serialized: string): Payload | null;
}

export interface ResolvedDrop<TargetId extends string> {
  readonly targetId: TargetId;
  readonly intent: DropIntent;
}

export interface AxisDragAndDropOptions<Payload, TargetId extends string> {
  readonly axis: DragAxis;
  readonly codec: DragPayloadCodec<Payload>;
  readonly disabled?: boolean;
  readonly onDrop?: (
    payload: Payload,
    resolved: ResolvedDrop<TargetId>,
    event: ReactDragEvent<HTMLElement> | DragEvent,
  ) => void;
}

export interface DragSourceProps {
  readonly draggable: boolean;
  readonly onDragStart: DragEventHandler<HTMLElement>;
  readonly onDragEnd: DragEventHandler<HTMLElement>;
}

export interface DropTargetProps {
  /**
   * Registers the rendered element so placement can still be resolved while
   * the pointer is outside the target's cross-axis bounds.
   */
  readonly ref: (node: HTMLElement | null) => void;
  readonly onDragOver: DragEventHandler<HTMLElement>;
  readonly onDragLeave: DragEventHandler<HTMLElement>;
  readonly onDrop: DragEventHandler<HTMLElement>;
}

export interface AxisDragAndDropController<
  Payload,
  TargetId extends string,
> {
  readonly payload: Payload | null;
  readonly targetId: TargetId | null;
  readonly intent: DropIntent | null;
  readonly getDragSourceProps: (payload: Payload) => DragSourceProps;
  readonly getDropTargetProps: (targetId: TargetId) => DropTargetProps;
}

interface ControllerState<Payload, TargetId extends string> {
  readonly payload: Payload | null;
  readonly targetId: TargetId | null;
  readonly intent: DropIntent | null;
}

function transferHasType(dataTransfer: DataTransfer, type: string): boolean {
  return Array.from(dataTransfer.types).includes(type);
}

function transferMatchesActivePayload(
  dataTransfer: DataTransfer,
  type: string,
  serializedPayload: string,
): boolean {
  if (!transferHasType(dataTransfer, type)) return false;
  try {
    const transferredPayload = dataTransfer.getData(type);
    // Browsers may protect drag data until drop and return an empty string.
    return transferredPayload === "" || transferredPayload === serializedPayload;
  } catch {
    return false;
  }
}

function resolveIntent(
  axis: DragAxis,
  event: ReactDragEvent<HTMLElement>,
): DropIntent {
  const span = spanAlongAxis(axis, event.currentTarget.getBoundingClientRect());
  return intentWithinSpan(span, pointerAlongAxis(axis, event));
}

export function useAxisDragAndDrop<Payload, TargetId extends string>(
  options: AxisDragAndDropOptions<Payload, TargetId>,
): AxisDragAndDropController<Payload, TargetId> {
  const { axis, codec, disabled = false } = options;
  const initialState: ControllerState<Payload, TargetId> = {
    payload: null,
    targetId: null,
    intent: null,
  };
  const [state, setState] =
    useState<ControllerState<Payload, TargetId>>(initialState);
  const stateRef = useRef(state);
  const serializedPayloadRef = useRef<string | null>(null);
  const lastResolvedDropRef = useRef<ResolvedDrop<TargetId> | null>(null);
  const disabledRef = useRef(disabled);
  const onDropRef = useRef(options.onDrop);
  /** The mounted drop targets, keyed by id, for axis placement. */
  const targetElementsRef = useRef(new Map<TargetId, HTMLElement>());

  disabledRef.current = disabled;
  onDropRef.current = options.onDrop;

  const updateState = useCallback(
    (next: ControllerState<Payload, TargetId>) => {
      const current = stateRef.current;
      if (
        Object.is(current.payload, next.payload) &&
        current.targetId === next.targetId &&
        current.intent === next.intent
      ) {
        return;
      }
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  const clearAll = useCallback(() => {
    serializedPayloadRef.current = null;
    lastResolvedDropRef.current = null;
    updateState({ payload: null, targetId: null, intent: null });
  }, [updateState]);

  const clearResolvedTarget = useCallback(
    (targetId?: TargetId, preserveLastResolved = false) => {
      const current = stateRef.current;
      if (targetId !== undefined && current.targetId !== targetId) return;
      if (!preserveLastResolved) lastResolvedDropRef.current = null;
      updateState({ ...current, targetId: null, intent: null });
    },
    [updateState],
  );

  const commitDrop = useCallback(
    (
      event: ReactDragEvent<HTMLElement> | DragEvent,
      expectedTargetId: TargetId | null,
    ) => {
      try {
        const current = stateRef.current;
        const activeSerialized = serializedPayloadRef.current;
        const transfer = event.dataTransfer;
        const serialized = transfer?.getData(codec.type) ?? "";
        const carriesActivePayload =
          transfer !== null &&
          activeSerialized !== null &&
          transferHasType(transfer, codec.type) &&
          (serialized === "" || serialized === activeSerialized);
        const payload = carriesActivePayload
          ? serialized === ""
            ? current.payload
            : codec.deserialize(serialized)
          : null;
        const targetId = expectedTargetId ?? current.targetId;
        if (
          !disabledRef.current &&
          payload !== null &&
          targetId !== null &&
          current.targetId === targetId &&
          current.intent !== null
        ) {
          onDropRef.current?.(
            payload,
            { targetId, intent: current.intent },
            event,
          );
        }
      } catch {
        // Invalid payloads are rejected and share the normal cleanup path.
      } finally {
        clearAll();
      }
    },
    [clearAll, codec],
  );

  const finishDrag = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const current = stateRef.current;
      const resolved =
        current.targetId !== null && current.intent !== null
          ? { targetId: current.targetId, intent: current.intent }
          : lastResolvedDropRef.current;
      try {
        // Some desktop webviews report the accepted target through dragover
        // but finish the gesture with dragend alone. A normal drop clears the
        // state before dragend, so this only fills that missing final event.
        if (
          !disabledRef.current &&
          current.payload !== null &&
          resolved !== null
        ) {
          onDropRef.current?.(current.payload, resolved, event);
        }
      } finally {
        clearAll();
      }
    },
    [clearAll],
  );

  useEffect(() => {
    if (disabled) clearAll();
  }, [clearAll, disabled]);

  const isDragging = state.payload !== null;

  /*
    While a drag is live the surface keeps targeting on its own axis, even when
    the pointer is outside every target's cross-axis bounds — above or below a
    horizontal tab strip, beside a vertical list. The controller only sees
    dragover on the target hitboxes themselves, so these document listeners
    resolve the remaining positions from the registered target geometry and
    accept the release there (#365).
  */
  useEffect(() => {
    if (!isDragging || disabled) return;

    const carriesActivePayload = (event: DragEvent) => {
      const serialized = serializedPayloadRef.current;
      if (stateRef.current.payload === null || serialized === null) return false;
      if (event.dataTransfer === null) return true;
      return transferMatchesActivePayload(
        event.dataTransfer,
        codec.type,
        serialized,
      );
    };

    const onDocumentDragOver = (event: DragEvent) => {
      // A drop target under the pointer has already resolved this position.
      if (event.defaultPrevented) return;
      if (!carriesActivePayload(event)) {
        clearResolvedTarget();
        return;
      }

      const placement = resolvePlacementAlongAxis(
        axis,
        event,
        targetElementsRef.current,
      );
      if (placement === null) {
        clearResolvedTarget();
        return;
      }

      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
      lastResolvedDropRef.current = placement;
      updateState({ ...stateRef.current, ...placement });
    };

    const onDocumentDrop = (event: DragEvent) => {
      // The target's own handler has already committed this release.
      if (event.defaultPrevented) return;
      if (stateRef.current.targetId === null) {
        clearAll();
        return;
      }
      event.preventDefault();
      commitDrop(event, null);
    };

    document.addEventListener("dragover", onDocumentDragOver);
    document.addEventListener("drop", onDocumentDrop);
    return () => {
      document.removeEventListener("dragover", onDocumentDragOver);
      document.removeEventListener("drop", onDocumentDrop);
    };
  }, [
    axis,
    clearAll,
    clearResolvedTarget,
    codec,
    commitDrop,
    disabled,
    isDragging,
    updateState,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearAll();
    };
    const onDocumentDragLeave = (event: DragEvent) => {
      const leftDocument =
        event.relatedTarget == null &&
        (event.target === document ||
          event.target === document.documentElement ||
          event.target === document.body);
      if (leftDocument) clearAll();
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragleave", onDocumentDragLeave);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("dragleave", onDocumentDragLeave);
    };
  }, [clearAll]);

  const getters = useMemo(() => {
    const sourceProps = new Map<string, DragSourceProps>();
    const targetProps = new Map<TargetId, DropTargetProps>();
    const invalidSourceProps: DragSourceProps = {
      draggable: false,
      onDragStart: (event) => {
        event.preventDefault();
        clearAll();
      },
      onDragEnd: clearAll,
    };

    const getDragSourceProps = (payload: Payload): DragSourceProps => {
      let serialized: string;
      let decoded: Payload | null;
      try {
        serialized = codec.serialize(payload);
        decoded = codec.deserialize(serialized);
      } catch {
        return invalidSourceProps;
      }
      if (decoded === null) return invalidSourceProps;

      const cached = sourceProps.get(serialized);
      if (cached) return cached;

      const props: DragSourceProps = {
        draggable: !disabled,
        onDragStart: (event) => {
          if (disabledRef.current) {
            event.preventDefault();
            clearAll();
            return;
          }

          try {
            event.dataTransfer.setData(codec.type, serialized);
            event.dataTransfer.effectAllowed = "move";
            serializedPayloadRef.current = serialized;
            updateState({ payload: decoded, targetId: null, intent: null });
          } catch {
            event.preventDefault();
            clearAll();
          }
        },
        onDragEnd: finishDrag,
      };
      sourceProps.set(serialized, props);
      return props;
    };

    const getDropTargetProps = (targetId: TargetId): DropTargetProps => {
      const cached = targetProps.get(targetId);
      if (cached) return cached;

      const props: DropTargetProps = {
        ref: (node) => {
          if (node === null) targetElementsRef.current.delete(targetId);
          else targetElementsRef.current.set(targetId, node);
        },
        onDragOver: (event) => {
          const current = stateRef.current;
          if (
            disabledRef.current ||
            current.payload === null ||
            serializedPayloadRef.current === null ||
            !transferMatchesActivePayload(
              event.dataTransfer,
              codec.type,
              serializedPayloadRef.current,
            )
          ) {
            clearResolvedTarget(targetId);
            return;
          }

          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const intent = resolveIntent(axis, event);
          lastResolvedDropRef.current = { targetId, intent };
          updateState({ ...current, targetId, intent });
        },
        onDragLeave: (event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          // Chromium and desktop webviews may emit this final leave before
          // dragend without ever emitting drop. Hide the visual seam, but keep
          // its accepted placement until another dragover or cancellation says
          // the pointer truly moved elsewhere.
          clearResolvedTarget(targetId, true);
        },
        onDrop: (event) => {
          event.preventDefault();
          commitDrop(event, targetId);
        },
      };
      targetProps.set(targetId, props);
      return props;
    };

    return { getDragSourceProps, getDropTargetProps };
  }, [
    axis,
    clearAll,
    clearResolvedTarget,
    codec,
    commitDrop,
    disabled,
    finishDrag,
    updateState,
  ]);

  return {
    ...state,
    ...getters,
  };
}
