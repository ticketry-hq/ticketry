import type { KeyboardEvent, ReactNode } from "react";

const ARROW_SCROLL_DISTANCE = 40;

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(value, maximum));
}

function scrollDiff(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.target !== event.currentTarget) return;

  const region = event.currentTarget;
  const maximumTop = Math.max(0, region.scrollHeight - region.clientHeight);
  const maximumLeft = Math.max(0, region.scrollWidth - region.clientWidth);

  switch (event.key) {
    case "ArrowUp":
      region.scrollTop = clamp(region.scrollTop - ARROW_SCROLL_DISTANCE, maximumTop);
      break;
    case "ArrowDown":
      region.scrollTop = clamp(region.scrollTop + ARROW_SCROLL_DISTANCE, maximumTop);
      break;
    case "PageUp":
      region.scrollTop = clamp(region.scrollTop - region.clientHeight, maximumTop);
      break;
    case "PageDown":
      region.scrollTop = clamp(region.scrollTop + region.clientHeight, maximumTop);
      break;
    case "Home":
      region.scrollTop = 0;
      break;
    case "End":
      region.scrollTop = maximumTop;
      break;
    case "ArrowLeft":
      region.scrollLeft = clamp(region.scrollLeft - ARROW_SCROLL_DISTANCE, maximumLeft);
      break;
    case "ArrowRight":
      region.scrollLeft = clamp(region.scrollLeft + ARROW_SCROLL_DISTANCE, maximumLeft);
      break;
    default:
      return;
  }

  event.preventDefault();
  event.stopPropagation();
}

export function DiffReadingRegion({ children }: { children: ReactNode }) {
  return (
    <div
      aria-label="File diff content"
      className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-accent"
      data-testid="changes-diff-scroll-region"
      onKeyDown={scrollDiff}
      role="region"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
