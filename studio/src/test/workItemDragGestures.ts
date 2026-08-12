import { fireEvent } from "@testing-library/react";

function dataTransfer(): DataTransfer {
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
    setDragImage: () => undefined,
  };
}

function dragEvent(
  target: Element,
  type: string,
  transfer: DataTransfer,
  clientY = 0,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
}

export function dragWorkItem(
  source: Element,
  target: Element,
  edge: "before" | "after",
) {
  const targetBlock = target.closest("li[role='none']");
  if (!(targetBlock instanceof HTMLElement)) {
    throw new Error("Work-item drag target is missing its layout block");
  }
  Object.defineProperty(targetBlock, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0,
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      width: 200,
    }),
  });
  const clientY = edge === "before" ? 25 : 75;
  const transfer = dataTransfer();
  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer, clientY);
  dragEvent(target, "drop", transfer, clientY);
}
