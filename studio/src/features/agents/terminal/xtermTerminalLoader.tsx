import { useEffect, useState } from "react";

import type { XtermTerminal, XtermTerminalProps } from "./XtermTerminal";

type XtermTerminalComponent = typeof XtermTerminal;

let loaded: XtermTerminalComponent | null = null;

/** Load the xterm renderer chunk; resolves to the component and caches it. */
export async function loadXtermTerminal(): Promise<XtermTerminalComponent> {
  loaded ??= (await import("./XtermTerminal")).XtermTerminal;
  return loaded;
}

/** Renders the xterm compatibility renderer, fetching its chunk on first use. */
export function LazyXtermTerminal(props: XtermTerminalProps) {
  const [Component, setComponent] = useState(() => loaded);
  useEffect(() => {
    if (Component) return;
    let active = true;
    void loadXtermTerminal().then((component) => {
      if (active) setComponent(() => component);
    });
    return () => {
      active = false;
    };
  }, [Component]);
  if (!Component) {
    return (
      <div className="h-full w-full bg-pane-panel" data-testid="terminal-renderer-pending" />
    );
  }
  return <Component {...props} />;
}
