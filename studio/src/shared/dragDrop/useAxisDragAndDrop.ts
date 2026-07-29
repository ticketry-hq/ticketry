import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type DragEventHandler,
} from "react";

export type DragAxis = "vertical" | "horizontal";
export type DropIntent = "near" | "far";

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
    event: ReactDragEvent<HTMLElement>,
  ) => void;
}

export interface DragSourceProps {
  readonly draggable: boolean;
  readonly onDragStart: DragEventHandler<HTMLElement>;
  readonly onDragEnd: DragEventHandler<HTMLElement>;
}

export interface DropTargetProps {
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
  const rect = event.currentTarget.getBoundingClientRect();
  const pointer = axis === "vertical" ? event.clientY : event.clientX;
  const start = axis === "vertical" ? rect.top : rect.left;
  const length = axis === "vertical" ? rect.height : rect.width;
  return pointer < start + length / 2 ? "near" : "far";
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
  const disabledRef = useRef(disabled);
  const onDropRef = useRef(options.onDrop);

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
    updateState({ payload: null, targetId: null, intent: null });
  }, [updateState]);

  const clearResolvedTarget = useCallback(
    (targetId?: TargetId) => {
      const current = stateRef.current;
      if (targetId !== undefined && current.targetId !== targetId) return;
      updateState({ ...current, targetId: null, intent: null });
    },
    [updateState],
  );

  useEffect(() => {
    if (disabled) clearAll();
  }, [clearAll, disabled]);

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
        onDragEnd: clearAll,
      };
      sourceProps.set(serialized, props);
      return props;
    };

    const getDropTargetProps = (targetId: TargetId): DropTargetProps => {
      const cached = targetProps.get(targetId);
      if (cached) return cached;

      const props: DropTargetProps = {
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
          updateState({ ...current, targetId, intent });
        },
        onDragLeave: (event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          clearResolvedTarget(targetId);
        },
        onDrop: (event) => {
          event.preventDefault();
          try {
            const serialized = event.dataTransfer.getData(codec.type);
            const payload = codec.deserialize(serialized);
            const current = stateRef.current;
            if (
              !disabledRef.current &&
              payload !== null &&
              serialized === serializedPayloadRef.current &&
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
    disabled,
    updateState,
  ]);

  return {
    ...state,
    ...getters,
  };
}
