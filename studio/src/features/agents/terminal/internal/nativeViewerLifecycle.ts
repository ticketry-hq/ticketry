import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { releasePooledTransport } from "./entryPool";
import { serializeNativeAttach } from "./nativeAttachQueue";
import { clippedNativeTerminalFrame } from "./nativeTerminalFrame";
import {
  publishPreparationFrames,
  settlePreparedFrame,
} from "./nativeTerminalPreparation";
import {
  nativeFailureMessage,
  type NativeTerminalCompletion,
  type NativeTerminalFailure,
  type NativeTerminalStatus,
} from "./nativeViewerFailure";
import {
  beginNativeViewerRelease,
  failNativeViewerMount,
  publishNativeViewerHandle,
  releaseNativeViewerMount,
  startNativeViewerLifecycle,
} from "./nativeViewerMountRegistry";
import {
  attachNativeViewer,
  forgetNativeViewer,
  showNativeViewer,
} from "./nativeViewerPresentation";
import { createViewerLease, desktopViewerLease } from "./viewerLease";

type NativeViewerLifecycleOptions = {
  runId: string;
  sessionId: string;
  token: symbol;
  host: () => HTMLElement | null;
  shouldPresent: () => boolean;
};

/**
 * Starts the one native attachment lifecycle retained by the terminal pool.
 *
 * The returned lifecycle is registered in the pool before attachment begins.
 * React hosts may come and go; only removal of the final host calls teardown.
 */
export function ensureNativeViewerLifecycle({
  runId,
  sessionId,
  token,
  host,
  shouldPresent,
}: NativeViewerLifecycleOptions): void {
  let disposed = false;
  let unlistenFailure: UnlistenFn | null = null;
  let unlistenCompletion: UnlistenFn | null = null;
  let completedHandle: string | null = null;
  let handle: string | null = null;
  let tornDown = false;
  const viewerLease = createViewerLease(desktopViewerLease, runId);
  let leaseTimer: ReturnType<typeof setInterval> | null = null;

  const releaseLease = () => {
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = null;
    void viewerLease.release().catch(() => {});
  };

  function unload() {
    teardown();
  }

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    disposed = true;
    window.removeEventListener("pagehide", unload);
    window.removeEventListener("beforeunload", unload);
    unlistenFailure?.();
    unlistenFailure = null;
    unlistenCompletion?.();
    unlistenCompletion = null;
    const detachedHandle = handle;
    handle = null;
    forgetNativeViewer(runId, detachedHandle);
    beginNativeViewerRelease(runId, token);
    if (detachedHandle) {
      void invoke("native_terminal_detach", { handle: detachedHandle })
        .catch(() => {})
        .finally(() => releaseNativeViewerMount(runId, token));
    } else {
      releaseNativeViewerMount(runId, token);
    }
    releaseLease();
  }

  function fail(reason: string) {
    if (tornDown) return;
    teardown();
    failNativeViewerMount(runId, reason);
  }

  if (!startNativeViewerLifecycle(runId, token, fail, teardown)) return;

  const closeCompletedViewer = (completion: NativeTerminalCompletion) => {
    completedHandle = completion.handle;
    if (handle !== completion.handle) return;
    // The native worker has already removed and freed this handle.
    handle = null;
    failNativeViewerMount(
      runId,
      "the native terminal attachment process exited",
    );
  };

  const attach = async () => {
    try {
      unlistenFailure = await listen<NativeTerminalFailure>(
        "native-terminal-failed",
        (event) => {
          if (event.payload.runId === runId && event.payload.handle === handle) {
            failNativeViewerMount(
              runId,
              event.payload.reason ?? "the native terminal process disconnected",
            );
          }
        },
      );
      unlistenCompletion = await listen<NativeTerminalCompletion>(
        "native-terminal-closed",
        (event) => {
          if (event.payload.runId === runId) closeCompletedViewer(event.payload);
        },
      );
      if (disposed || tornDown) {
        unlistenFailure();
        unlistenFailure = null;
        unlistenCompletion();
        unlistenCompletion = null;
        return;
      }

      const attachmentHost = host();
      if (!attachmentHost) throw new Error("native terminal host was not mounted");
      const frame = clippedNativeTerminalFrame(attachmentHost);
      if (!frame) throw new Error("native terminal host has no visible frame");
      const preparation = publishPreparationFrames(attachmentHost, runId, frame);
      let status: NativeTerminalStatus | null;
      let initiallyPresented = false;
      try {
        const activation = await attachNativeViewer(
          runId,
          () => serializeNativeAttach(runId, async () => {
            if (disposed || tornDown) return null;
            const attached = await invoke<NativeTerminalStatus>(
              "native_terminal_attach",
              { runId, frame },
            );
            if (disposed || tornDown) {
              await invoke("native_terminal_detach", {
                handle: attached.handle,
              }).catch(() => {});
              return null;
            }
            return attached;
          }),
        );
        status = activation.status;
        initiallyPresented = activation.presented;
      } finally {
        preparation.stop();
      }
      if (!status) return;
      handle = status.handle;
      if (status.columns <= 0 || status.rows <= 0) {
        throw new Error("native terminal renderer returned an empty grid");
      }
      if (completedHandle === status.handle) {
        handle = null;
        failNativeViewerMount(
          runId,
          "the native terminal attachment process exited",
        );
        return;
      }
      if (disposed || tornDown) {
        handle = null;
        void invoke("native_terminal_detach", { handle: status.handle }).catch(
          () => {},
        );
        return;
      }
      const settled = await settlePreparedFrame(
        attachmentHost,
        status.handle,
        preparation.published(),
        status,
      );
      if (disposed || tornDown) {
        handle = null;
        void invoke("native_terminal_detach", { handle: status.handle }).catch(
          () => {},
        );
        return;
      }
      if (settled.columns <= 0 || settled.rows <= 0) {
        throw new Error("native terminal renderer returned an empty grid");
      }
      const acquired = await viewerLease.acquire();
      if (!acquired || disposed || tornDown) {
        const detachedHandle = handle;
        handle = null;
        if (detachedHandle) {
          void invoke("native_terminal_detach", { handle: detachedHandle }).catch(
            () => {},
          );
        }
        releaseLease();
        return;
      }
      const shown = await showNativeViewer(runId, status.handle, async () => {
        if (!shouldPresent() || disposed || tornDown) return null;
        const currentHost = host();
        if (!currentHost) return null;
        const currentFrame = clippedNativeTerminalFrame(currentHost);
        if (!currentFrame) return null;
        await invoke("native_terminal_show", {
          handle: status.handle,
          frame: currentFrame,
        });
        // The native show command validates the resulting grid before it
        // resolves. A sentinel keeps successful void test doubles distinct
        // from the null result used when presentation authority has moved.
        return true;
      });
      initiallyPresented = shown !== null;
      if (disposed || tornDown) {
        handle = null;
        void invoke("native_terminal_detach", { handle: status.handle }).catch(
          () => {},
        );
        releaseLease();
        return;
      }
      attachmentHost.replaceChildren();
      releasePooledTransport(sessionId);
      publishNativeViewerHandle(
        runId,
        token,
        status.handle,
        initiallyPresented,
      );
      leaseTimer = setInterval(() => {
        void viewerLease.renew().catch((error) => {
          if (!disposed) failNativeViewerMount(runId, nativeFailureMessage(error));
        });
      }, 10_000);
    } catch (error) {
      console.error("native libghostty attach failed", error);
      failNativeViewerMount(runId, nativeFailureMessage(error));
    }
  };

  window.addEventListener("pagehide", unload);
  window.addEventListener("beforeunload", unload);
  void attach();
}
