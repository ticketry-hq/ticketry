import { Composition } from "remotion";
import { Promo } from "./Promo";
import { FPS, TOTAL_FRAMES } from "./timeline";

export const Root = () => (
  <Composition id="Promo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
