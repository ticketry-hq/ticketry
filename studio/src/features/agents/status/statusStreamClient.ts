/**
 * The transport half of Studio's only status authority.
 *
 * The status WebSocket was retired at the Slice 3 handoff, so this client and
 * the feed above it are the whole of how status reaches Studio. Its job is
 * narrow: turn the typed union into safe, ordered calls on the supplied
 * handlers, and retain one monotonic cursor per project.
 */
import type { CreateGraphQlTransportProxy } from "../../../graphql-foundation/foundationClient";
import {
  RunStatusStreamDocument,
  type RunStatusCaughtUpFrame,
  type RunStatusEventFrame,
  type RunStatusFailedFrame,
  type RunStatusFrame,
  type RunStatusResetRequiredFrame,
  type RunStatusSnapshotFrame,
} from "./generated/statusStream";
import type { StatusCursorStore } from "./statusStreamCursors";

/** The payload versions this build understands. */
export const SUPPORTED_PAYLOAD_VERSION = 1;

export interface StatusStreamHandlers {
  onSnapshot?(frame: RunStatusSnapshotFrame): void;
  onEvent?(frame: RunStatusEventFrame): void;
  onCaughtUp?(frame: RunStatusCaughtUpFrame): void;
  onResetRequired?(frame: RunStatusResetRequiredFrame): void;
  onFailed?(frame: RunStatusFailedFrame): void;
  onComplete?(): void;
}

export interface StatusStreamClientOptions {
  readonly projectId: string;
  readonly subscriptionId: string;
  readonly cursors: StatusCursorStore;
  readonly createProxy: CreateGraphQlTransportProxy;
  readonly handlers: StatusStreamHandlers;
}

export interface StatusStreamClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Install a baseline the caller has earned: the reset cursor once its
   * authoritative refresh succeeded, or a buffered fact applied above it. The
   * client never installs a reset baseline on its own, because only the caller
   * knows whether the canonical holdings actually loaded.
   */
  acceptBaseline(cursor: number): void;
}

interface Envelope {
  readonly type?: unknown;
  readonly payload?: {
    readonly data?: { readonly run_status_stream?: unknown } | null;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Structural check: an unknown or malformed member is ignored, never applied. */
function readFrame(value: unknown): RunStatusFrame | null {
  if (!isRecord(value)) return null;
  const typename = value.__typename;
  const cursor = value.cursor;
  const projectId = value.project_id;
  switch (typename) {
    case "RunStatusSnapshot":
      return typeof projectId === "string" &&
        typeof cursor === "number" &&
        Array.isArray(value.runs) &&
        Array.isArray(value.automation_attempts)
        ? (value as unknown as RunStatusSnapshotFrame)
        : null;
    case "RunStatusEvent":
      return typeof projectId === "string" &&
        typeof cursor === "number" &&
        typeof value.event_id === "string" &&
        typeof value.event_kind === "string" &&
        typeof value.payload_version === "number" &&
        isRecord(value.payload)
        ? (value as unknown as RunStatusEventFrame)
        : null;
    case "RunStatusCaughtUp":
      return typeof projectId === "string" && typeof cursor === "number"
        ? (value as unknown as RunStatusCaughtUpFrame)
        : null;
    case "RunStatusResetRequired":
      return typeof projectId === "string" &&
        typeof cursor === "number" &&
        typeof value.reason === "string"
        ? (value as unknown as RunStatusResetRequiredFrame)
        : null;
    case "RunStatusFailed":
      return typeof value.code === "string" && typeof value.message === "string"
        ? (value as unknown as RunStatusFailedFrame)
        : null;
    default:
      return null;
  }
}

export function createStatusStreamClient(
  options: StatusStreamClientOptions,
): StatusStreamClient {
  const { projectId, subscriptionId, cursors, createProxy, handlers } = options;
  let stopped = false;
  /**
   * True from a reset frame until the caller installs the baseline it earned.
   * While it is set the retained cursor is untouchable: it still describes
   * history the server has refused to replay, so measuring incoming facts
   * against it would silently accept the stale holding under them.
   */
  let resetting = false;

  const dispatch = (frame: RunStatusFrame): void => {
    // A project switch tears the subscription down asynchronously. A frame
    // that belongs to another project must never touch this project's holding.
    if ("project_id" in frame && frame.project_id !== projectId) return;
    switch (frame.__typename) {
      case "RunStatusSnapshot":
        // The snapshot announces the high-water baseline the replay walks up
        // to. Installing it here would make every replayed event look
        // backwards, so only caught-up and reset install a baseline.
        handlers.onSnapshot?.(frame);
        return;
      case "RunStatusEvent":
        // A retained event this build cannot read is skipped rather than
        // guessed at, and it does not advance the cursor past itself.
        if (frame.payload_version > SUPPORTED_PAYLOAD_VERSION) return;
        // Mid-reset the cursor is not a usable filter, so the fact is handed
        // over whole. The caller buffers it and decides against the baseline
        // it installs.
        if (resetting) {
          handlers.onEvent?.(frame);
          return;
        }
        if (!cursors.advance(projectId, frame.cursor)) return;
        handlers.onEvent?.(frame);
        return;
      case "RunStatusCaughtUp":
        // The caught-up cursor of a resetting handshake is the reset cursor
        // itself. Installing it here would baseline before the canonical
        // holdings loaded, which is precisely what the reset exists to prevent.
        if (resetting) return;
        cursors.install(projectId, frame.cursor);
        handlers.onCaughtUp?.(frame);
        return;
      case "RunStatusResetRequired":
        resetting = true;
        handlers.onResetRequired?.(frame);
        return;
      case "RunStatusFailed":
        handlers.onFailed?.(frame);
    }
  };

  const receive = (encoded: string): void => {
    if (stopped) return;
    let envelope: Envelope;
    try {
      envelope = JSON.parse(encoded) as Envelope;
    } catch {
      return; // Malformed transport payloads are ignored safely.
    }
    if (envelope.type === "complete") {
      handlers.onComplete?.();
      return;
    }
    if (envelope.type !== "next") return;
    const frame = readFrame(envelope.payload?.data?.run_status_stream);
    if (frame) dispatch(frame);
  };

  return {
    async start() {
      stopped = false;
      const afterCursor = cursors.get(projectId);
      await createProxy().graphql_subscribe(
        subscriptionId,
        JSON.stringify({
          query: RunStatusStreamDocument.source,
          operationName: RunStatusStreamDocument.operationName,
          variables: { projectId, afterCursor: afterCursor ?? null },
        }),
        receive,
      );
    },
    async stop() {
      stopped = true;
      await createProxy().graphql_unsubscribe(subscriptionId);
    },
    acceptBaseline(cursor) {
      resetting = false;
      cursors.install(projectId, cursor);
    },
  };
}
