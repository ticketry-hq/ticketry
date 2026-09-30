import { AbsoluteFill, Sequence } from "remotion";
import { AppWindow } from "./AppWindow";
import { Background } from "./Background";
import { TitleCard } from "./TitleCard";
import { INTRO_FRAMES, MAIN_FRAMES, OUTRO_FRAMES, OVERLAP } from "./timeline";

export const Promo = () => (
  <AbsoluteFill>
    <Background />
    <Sequence durationInFrames={INTRO_FRAMES}>
      <TitleCard title="Ticketry" lines={["Plan the work. Branch it. Ship it."]} fadeOutAt={INTRO_FRAMES - OVERLAP - 5} />
    </Sequence>
    <Sequence from={INTRO_FRAMES - OVERLAP} durationInFrames={MAIN_FRAMES}>
      <AppWindow />
    </Sequence>
    <Sequence from={INTRO_FRAMES + MAIN_FRAMES - 2 * OVERLAP} durationInFrames={OUTRO_FRAMES}>
      <TitleCard title="Ticketry" lines={["Stories, worktrees and terminals in one place.", "Rust · Tauri · tmux"]} />
    </Sequence>
  </AbsoluteFill>
);
