import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

const VIEWPORT_GAP = 16;
const MAX_TOAST_WIDTH = 360;
const NATIVE_HOST_SELECTOR = "[data-native-terminal-presented]";
const STATUS_BAR_SELECTOR = "[data-studio-status-bar]";

interface ToastViewportPlacement {
  ref: RefObject<HTMLDivElement>;
  style: CSSProperties;
}

interface MeasuredPlacement {
  bottom: number;
  maxHeight: number;
}

function samePlacement(
  current: MeasuredPlacement,
  next: MeasuredPlacement,
): MeasuredPlacement {
  return current.bottom === next.bottom && current.maxHeight === next.maxHeight
    ? current
    : next;
}

/** Keeps the WebView toast stack out of every presented native view rectangle. */
export function useToastViewportPlacement(active: boolean): ToastViewportPlacement {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MeasuredPlacement>({
    bottom: 40,
    maxHeight: 544,
  });

  useLayoutEffect(() => {
    if (!active) return;
    const viewport = ref.current;
    if (!viewport) return;

    let animationFrame = 0;
    const measure = () => {
      animationFrame = 0;
      const viewportRect = viewport.getBoundingClientRect();
      const candidateLeft = viewportRect.width > 0
        ? viewportRect.left
        : VIEWPORT_GAP;
      const candidateRight = viewportRect.width > 0
        ? viewportRect.right
        : Math.min(window.innerWidth - VIEWPORT_GAP, VIEWPORT_GAP + MAX_TOAST_WIDTH);
      const statusBar = document.querySelector(STATUS_BAR_SELECTOR);
      const statusBarTop = statusBar?.getBoundingClientRect().top ?? window.innerHeight;
      let bottom = Math.max(
        VIEWPORT_GAP,
        window.innerHeight - statusBarTop + VIEWPORT_GAP,
      );

      for (const host of document.querySelectorAll(NATIVE_HOST_SELECTOR)) {
        const rect = host.getBoundingClientRect();
        const overlapsHorizontally =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < candidateRight &&
          rect.right > candidateLeft;
        if (overlapsHorizontally) {
          bottom = Math.max(bottom, window.innerHeight - rect.top + VIEWPORT_GAP);
        }
      }

      setPlacement((current) => samePlacement(current, {
        bottom,
        maxHeight: Math.max(0, window.innerHeight - bottom - VIEWPORT_GAP),
      }));
    };
    const scheduleMeasure = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    const observePlacementElements = () => {
      resizeObserver?.disconnect();
      resizeObserver?.observe(viewport);
      const statusBar = document.querySelector(STATUS_BAR_SELECTOR);
      if (statusBar) resizeObserver?.observe(statusBar);
      for (const host of document.querySelectorAll(NATIVE_HOST_SELECTOR)) {
        resizeObserver?.observe(host);
      }
      scheduleMeasure();
    };
    const mutationObserver = new MutationObserver(observePlacementElements);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-native-terminal-presented", "data-studio-status-bar"],
    });
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    observePlacementElements();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [active]);

  return {
    ref,
    style: {
      left: "max(1rem, env(safe-area-inset-left))",
      bottom: `calc(${placement.bottom}px + env(safe-area-inset-bottom))`,
      maxHeight: `calc(${placement.maxHeight}px - env(safe-area-inset-top))`,
      width:
        "min(360px, calc(100vw - max(1rem, env(safe-area-inset-left)) - max(1rem, env(safe-area-inset-right))))",
    },
  };
}
