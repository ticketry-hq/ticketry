import { useEffect, useRef } from "react";

import { onModalOcclusionBegin } from "./modalOcclusion";

export function useOcclusionAwareFocusSignal(
  focusSignal: number | undefined,
  occluded: boolean,
) {
  const handledFocusSignalRef = useRef(0);
  const discardedFocusSignalRef = useRef(0);
  const focusSignalRef = useRef(focusSignal);
  focusSignalRef.current = focusSignal;

  useEffect(
    () =>
      onModalOcclusionBegin(() => {
        const signal = focusSignalRef.current;
        if (signal === undefined || signal === 0) return;
        handledFocusSignalRef.current = signal;
        discardedFocusSignalRef.current = signal;
      }),
    [],
  );

  useEffect(() => {
    if (!occluded || focusSignal === undefined || focusSignal === 0) return;
    handledFocusSignalRef.current = focusSignal;
    discardedFocusSignalRef.current = focusSignal;
  }, [focusSignal, occluded]);

  return { discardedFocusSignalRef, handledFocusSignalRef };
}
