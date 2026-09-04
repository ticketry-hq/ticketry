export interface ResolvedTerminalBackground {
  css: string;
  rgb: readonly [number, number, number];
}

export const TERMINAL_FOREGROUND_RGB = [0xd6, 0xde, 0xeb] as const;

const PANE_PANEL_BACKGROUND: ResolvedTerminalBackground = {
  css: "rgb(17, 19, 23)",
  rgb: [17, 19, 23],
};

/** Find the first opaque background painted behind the terminal host. */
export function resolveTerminalHostBackground(
  host: HTMLElement,
): ResolvedTerminalBackground {
  let element: HTMLElement | null = host;
  while (element) {
    const parsed = parseOpaqueRgb(getComputedStyle(element).backgroundColor);
    if (parsed) return parsed;
    element = element.parentElement;
  }
  return PANE_PANEL_BACKGROUND;
}

function parseOpaqueRgb(value: string): ResolvedTerminalBackground | null {
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) return null;
  if (channels.length >= 4 && channels[3] < 1) return null;
  const rgb = channels.slice(0, 3).map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel)))
  ) as [number, number, number];
  return { css: `rgb(${rgb.join(", ")})`, rgb };
}
