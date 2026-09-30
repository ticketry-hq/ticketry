import { AbsoluteFill } from "remotion";

// Near-black matched to the app chrome, with one soft light behind the window.
export const Background = () => (
  <AbsoluteFill
    style={{
      background:
        "radial-gradient(ellipse 70% 55% at 50% 55%, #1a1e2b 0%, #0d0f15 55%, #08090c 100%)",
    }}
  />
);
