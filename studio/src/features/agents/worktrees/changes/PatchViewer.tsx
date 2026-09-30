import { PatchDiff } from "@pierre/diffs/react";
import { useEffect, useRef } from "react";

export default function PatchViewer({ patch }: { patch: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let observer: MutationObserver | undefined;
    const connect = () => {
      const host = rootRef.current?.firstElementChild as HTMLElement | null;
      const code = host?.shadowRoot?.querySelector<HTMLElement>("[data-code]");
      if (!host || !code) {
        frame = requestAnimationFrame(connect);
        return;
      }
      const exposeWidth = () => {
        if (code.scrollWidth > 0) host.style.width = `${code.scrollWidth}px`;
      };
      exposeWidth();
      observer = new MutationObserver(exposeWidth);
      observer.observe(code, { childList: true, subtree: true, characterData: true });
    };
    frame = requestAnimationFrame(connect);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [patch]);

  return (
    <div
      ref={rootRef}
      className="min-w-max [--diffs-overflow-override:visible]"
      data-testid="patch-viewer"
    >
      <PatchDiff
        patch={patch}
        options={{
          theme: "tokyo-night",
          themeType: "dark",
          diffStyle: "unified",
          overflow: "scroll",
          disableFileHeader: true,
          enableLineSelection: false,
        }}
      />
    </div>
  );
}
