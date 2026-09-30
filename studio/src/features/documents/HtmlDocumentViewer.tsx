import { useEffect, useRef } from "react";

import { documentUrl } from "./documentUrl";
import type { DesignDoc } from "./types";

export function HtmlDocumentViewer({
  doc,
  focusSignal,
}: {
  doc: DesignDoc;
  focusSignal: number;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (focusSignal > 0) frameRef.current?.focus();
  }, [focusSignal]);

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
