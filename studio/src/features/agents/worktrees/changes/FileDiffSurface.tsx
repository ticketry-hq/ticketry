import { Component, lazy, Suspense, type ReactNode } from "react";

import { RawPatch } from "./RawPatch";

const PatchViewer = lazy(() => import("./PatchViewer"));

export function FileDiffSurface({ patch }: { patch: string }) {
  return (
    <PatchRenderBoundary fallback={<RawPatch patch={patch} />}>
      <Suspense fallback={<RawPatch patch={patch} />}>
        <PatchViewer patch={patch} />
      </Suspense>
    </PatchRenderBoundary>
  );
}

class PatchRenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
