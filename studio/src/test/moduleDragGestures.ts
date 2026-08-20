import { fireEvent, screen } from "@testing-library/react";

/** Synthetic HTML5 drag gestures for the two module reorder surfaces. */

export function dataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() {
      return [...values.keys()];
    },
    clearData: (type?: string) => (type ? values.delete(type) : values.clear()),
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
}

export function dragEvent(
  target: Element,
  type: string,
  transfer: DataTransfer,
  point: { clientX?: number; clientY?: number } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: point.clientX ?? 0 },
    clientY: { value: point.clientY ?? 0 },
  });
  fireEvent(target, event);
}

export const transientDocumentDragLeaveTargets = [
  "document",
  "body",
  "documentElement",
] as const;

export type TransientDocumentDragLeaveTarget =
  (typeof transientDocumentDragLeaveTargets)[number];

/** The transient leave shapes emitted at a document/WebView boundary. */
export function transientDocumentDragLeave(
  transfer: unknown,
  targetName: TransientDocumentDragLeaveTarget = "document",
): void {
  const event = new Event("dragleave", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    relatedTarget: { value: null },
  });
  const target =
    targetName === "document"
      ? document
      : targetName === "body"
        ? document.body
        : document.documentElement;
  fireEvent(target, event);
}

const ROW_HEIGHT = 20;
const TAB_WIDTH = 100;

function moduleRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("li[data-module-id]"),
  );
}

/** Give the rendered rows a real vertical layout so midpoints can resolve. */
export function layoutRows(): Map<string, HTMLElement> {
  const byId = new Map<string, HTMLElement>();
  moduleRows().forEach((row, index) => {
    const top = index * ROW_HEIGHT;
    Object.defineProperty(row, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top,
        bottom: top + ROW_HEIGHT,
        height: ROW_HEIGHT,
        left: 0,
        right: 200,
        width: 200,
      }),
    });
    byId.set(row.dataset.moduleId ?? "", row);
  });
  return byId;
}

/** Give the rendered tabs a real horizontal layout so midpoints can resolve. */
export function layoutTabs(): Map<string, HTMLElement> {
  const byId = new Map<string, HTMLElement>();
  screen.getAllByRole("tab").forEach((tab, index) => {
    const left = index * TAB_WIDTH;
    Object.defineProperty(tab, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        bottom: 28,
        height: 28,
        left,
        right: left + TAB_WIDTH,
        width: TAB_WIDTH,
      }),
    });
    byId.set(tab.dataset.moduleId ?? "", tab);
  });
  return byId;
}

/** Drag one sidebar module onto the near (top) or far (bottom) half of another. */
export function dragModule(
  sourceId: string,
  targetId: string,
  edge: "near" | "far",
  { drop = true }: { drop?: boolean } = {},
) {
  const laidOut = layoutRows();
  const source = laidOut.get(sourceId)!;
  const target = laidOut.get(targetId)!;
  const rect = target.getBoundingClientRect();
  const clientY = edge === "near" ? rect.top + 2 : rect.bottom - 2;
  const transfer = dataTransfer();

  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer, { clientY });
  if (drop) dragEvent(target, "drop", transfer, { clientY });
  return { source, target, transfer };
}

/** Drag one Module tab onto the near (left) or far (right) half of another. */
export function dragTab(
  sourceId: string,
  targetId: string,
  edge: "near" | "far",
  { drop = true }: { drop?: boolean } = {},
) {
  const laidOut = layoutTabs();
  const source = laidOut.get(sourceId)!;
  const target = laidOut.get(targetId)!;
  const rect = target.getBoundingClientRect();
  const clientX = edge === "near" ? rect.left + 2 : rect.right - 2;
  const transfer = dataTransfer();

  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer, { clientX });
  if (drop) dragEvent(target, "drop", transfer, { clientX });
  return { source, target, transfer };
}

/**
 * Drag a Module tab and let the pointer drift above the strip — outside every
 * tab's height — before hovering and releasing there.
 */
export function dragTabAboveStrip(
  sourceId: string,
  targetId: string,
  edge: "near" | "far",
  { drop = true }: { drop?: boolean } = {},
) {
  const laidOut = layoutTabs();
  const source = laidOut.get(sourceId)!;
  const target = laidOut.get(targetId)!;
  const rect = target.getBoundingClientRect();
  const clientX = edge === "near" ? rect.left + 2 : rect.right - 2;
  const clientY = rect.top - 40;
  const transfer = dataTransfer();

  dragEvent(source, "dragstart", transfer);
  dragEvent(document.body, "dragover", transfer, { clientX, clientY });
  if (drop) dragEvent(document.body, "drop", transfer, { clientX, clientY });
  return { source, target, transfer };
}
