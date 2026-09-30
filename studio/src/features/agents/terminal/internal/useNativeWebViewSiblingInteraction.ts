import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useEffect, useRef } from "react";

import type { NativeTerminalFrame } from "./nativeTerminalFrame";
import { NATIVE_TERMINAL_INPUT_ATTRIBUTE } from "./terminalInputFocus";

const WEBVIEW_OVERLAY_SELECTOR = [
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  "[data-native-terminal-overlay]",
].join(",");

type InteractionHost = {
  handle: string;
  hostRef: RefObject<HTMLElement | null>;
  onFailure: (error: unknown) => void;
};

const interactionHosts = new Map<symbol, InteractionHost>();
let selectedHandle: string | null = null;
let interactionGeneration = 0;
let releaseWindowListeners: (() => void) | null = null;

function selectedHandleForTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Node)) return null;
  for (const owner of interactionHosts.values()) {
    if (owner.hostRef.current?.contains(target)) return owner.handle;
  }
  return null;
}

function overlayFrame(element: Element): NativeTerminalFrame | null {
  const rect = element.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (right <= x || bottom <= y) return null;
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

function currentOverlayFrames(): NativeTerminalFrame[] {
  return Array.from(document.querySelectorAll(WEBVIEW_OVERLAY_SELECTOR))
    .filter(
      (element) => !element.parentElement?.closest(WEBVIEW_OVERLAY_SELECTOR),
    )
    .map(overlayFrame)
    .filter((frame): frame is NativeTerminalFrame => frame !== null);
}

function hostForHandle(handle: string): InteractionHost | null {
  for (const host of interactionHosts.values()) {
    if (host.handle === handle) return host;
  }
  return null;
}

function publishInteraction(
  handle: string,
  webviewFocus: boolean,
  overlayFrames: NativeTerminalFrame[],
): Promise<void> {
  const host = hostForHandle(handle);
  if (!host) return Promise.resolve();
  interactionGeneration += 1;
  return invoke<void>("native_terminal_set_webview_interaction", {
    handle,
    webviewFocus,
    overlayFrames,
    generation: interactionGeneration,
  }).catch((error) => {
    console.error("native WebView sibling interaction update failed", error);
    host.onFailure(error);
  });
}

/** Programmatic focus must transfer native input ownership just like a click. */
export function selectNativeTerminalInput(handle: string): Promise<void> | null {
  if (!hostForHandle(handle)) return null;
  selectedHandle = handle;
  markSelectedHost(handle);
  return publishInteraction(handle, false, []);
}

function markSelectedHost(handle: string | null): void {
  for (const owner of interactionHosts.values()) {
    const host = owner.hostRef.current;
    if (!host) continue;
    if (handle !== null && owner.handle === handle) {
      host.setAttribute(NATIVE_TERMINAL_INPUT_ATTRIBUTE, "");
    } else {
      host.removeAttribute(NATIVE_TERMINAL_INPUT_ATTRIBUTE);
    }
  }
}

function lowerSelected(overlayFrames = currentOverlayFrames()): void {
  const previousHandle = selectedHandle;
  selectedHandle = null;
  markSelectedHost(null);
  if (previousHandle) publishInteraction(previousHandle, true, overlayFrames);
}

function isFocusPreserving(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return element?.closest("[data-native-terminal-focus-preserving]") != null;
}

// The click that selects a native host must not also run the browser's default
// mousedown action: that moves DOM focus to the focusable workspace body and
// WebKit then takes first responder back from the terminal the user just
// clicked into. Propagation continues, so the body still engages the tab.
function preventFocusSteal(event: MouseEvent): void {
  if (isFocusPreserving(event.target)) return;
  if (selectedHandleForTarget(event.target)) event.preventDefault();
}

function selectFromPointer(event: PointerEvent): void {
  if (isFocusPreserving(event.target)) return;
  const nextHandle = selectedHandleForTarget(event.target);
  if (!nextHandle) {
    lowerSelected();
    return;
  }
  if (nextHandle === selectedHandle) return;
  selectedHandle = nextHandle;
  markSelectedHost(nextHandle);
  publishInteraction(nextHandle, false, []);
}

function installWindowListeners(): () => void {
  let animationFrame = 0;
  const inspectOverlays = () => {
    animationFrame = 0;
    const overlayFrames = currentOverlayFrames();
    if (overlayFrames.length > 0) lowerSelected(overlayFrames);
  };
  const scheduleOverlayInspection = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(inspectOverlays);
  };
  // No window-blur handler: WebKit fires DOM `blur` on the window the moment
  // the native terminal becomes first responder, so lowering on blur would
  // hand input straight back to the WebView after every selecting click.
  const observer = new MutationObserver(scheduleOverlayInspection);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-modal", "role", "data-native-terminal-overlay"],
  });
  window.addEventListener("resize", scheduleOverlayInspection);
  window.addEventListener("scroll", scheduleOverlayInspection, true);
  window.addEventListener("pointerdown", selectFromPointer, true);
  window.addEventListener("mousedown", preventFocusSteal, true);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", scheduleOverlayInspection);
    window.removeEventListener("scroll", scheduleOverlayInspection, true);
    window.removeEventListener("pointerdown", selectFromPointer, true);
    window.removeEventListener("mousedown", preventFocusSteal, true);
    if (animationFrame) cancelAnimationFrame(animationFrame);
  };
}

function registerInteractionHost(token: symbol, host: InteractionHost): () => void {
  const handleAlreadyRegistered = hostForHandle(host.handle) !== null;
  interactionHosts.set(token, host);
  document.documentElement.classList.add("native-webview-sibling");
  releaseWindowListeners ??= installWindowListeners();
  if (!handleAlreadyRegistered) publishInteraction(host.handle, true, []);

  return () => {
    interactionHosts.delete(token);
    const handleStillRegistered = hostForHandle(host.handle) !== null;
    if (selectedHandle === host.handle && !handleStillRegistered) {
      selectedHandle = null;
      markSelectedHost(null);
      interactionGeneration += 1;
      void invoke("native_terminal_set_webview_interaction", {
        handle: host.handle,
        webviewFocus: true,
        overlayFrames: currentOverlayFrames(),
        generation: interactionGeneration,
      }).catch(host.onFailure);
    }
    if (interactionHosts.size > 0) return;
    releaseWindowListeners?.();
    releaseWindowListeners = null;
    document.documentElement.classList.remove("native-webview-sibling");
  };
}

/**
 * Registers one visible, presented native host in the window interaction map.
 * The shared listener consumes the DOM activation click and gives native code
 * one generation-fenced selection change. Native input receives later clicks.
 */
export function useNativeWebViewSiblingInteraction(
  handle: string | null,
  hostRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  webviewOwnsFocus: boolean,
  onFailure?: (error: unknown) => void,
): void {
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;

  useEffect(() => {
    if (!enabled || !handle) return;
    const token = Symbol(handle);
    return registerInteractionHost(token, {
      handle,
      hostRef,
      onFailure: (error) => failureRef.current?.(error),
    });
  }, [enabled, handle, hostRef]);

  useEffect(() => {
    if (enabled && handle && webviewOwnsFocus && selectedHandle === handle) {
      lowerSelected();
    }
  }, [enabled, handle, webviewOwnsFocus]);
}
