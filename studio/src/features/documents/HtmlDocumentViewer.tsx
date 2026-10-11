import { useEffect, useRef } from "react";

import { documentUrl } from "./documentUrl";
import type { DesignDoc } from "./types";

export function HtmlDocumentViewer({
  doc,
  focusSignal,
  canFocus,
}: {
  doc: DesignDoc;
  focusSignal: number;
  canFocus?: (target?: HTMLElement | null) => boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (focusSignal > 0 && (canFocus?.(frameRef.current) ?? true)) frameRef.current?.focus();
  }, [focusSignal, canFocus]);

  return (
    <iframe
      ref={frameRef}
      title={doc.label}
      src={documentUrl(doc.id, doc.rel_path)}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
      data-testid="workspace-doc-frame"
    />
  );
}
