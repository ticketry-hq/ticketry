import { Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "./Caption";
import { FPS, MAIN_FRAMES, SCENE_STARTS, SCENES, SOURCE, sceneFrames, type Focus } from "./timeline";

const SCALE = 1.1; // window size relative to the 1600x900 recording
const BAR = 34; // title bar height

const MOVE = 0.5 * FPS; // frames per camera move

// Absolute camera keyframes across all scenes, in main-section frames.
const KEYS = SCENES.flatMap((scene, i) => scene.camera.map((key) => ({ ...key, frame: SCENE_STARTS[i] + Math.round(key.at * FPS) })));

// Snap to each keyframe over MOVE frames, then hold.
const cameraAt = (frame: number): Focus => {
  const k = Math.max(0, KEYS.findLastIndex((key) => frame >= key.frame));
  const from = KEYS[Math.max(0, k - 1)];
  const to = KEYS[k];
  const t = interpolate(frame, [to.frame, to.frame + MOVE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) });
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, zoom: from.zoom + (to.zoom - from.zoom) * t };
};

export const AppWindow = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, mass: 1.2 } });
  const exit = interpolate(frame, [MAIN_FRAMES - 20, MAIN_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const cam = cameraAt(frame);
  // Translate so the focus point sits at the window center, clamped to the recording edges.
  const clampPan = (focus: number, size: number) => {
    const half = size / (2 * cam.zoom);
    return Math.min(size - half, Math.max(half, focus)) - size / 2;
  };
  const panX = clampPan(cam.x, SOURCE.width);
  const panY = clampPan(cam.y, SOURCE.height);
  const w = SOURCE.width * SCALE;
  const h = SOURCE.height * SCALE;
  const drift = Math.sin(frame / 90) * 1.5;
  const terminalCut = SCENE_STARTS[SCENES.length - 1];
  const flash = interpolate(frame, [terminalCut - 4, terminalCut, terminalCut + 6], [0, 0.18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div style={{ position: "absolute", inset: 0, perspective: 2200 }}>
      <div
        style={{
          position: "absolute", left: (1920 - w) / 2, top: (1080 - h - BAR) / 2, width: w, height: h + BAR,
          borderRadius: 14, overflow: "hidden", background: "#11131a",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.5)",
          opacity: enter * (1 - exit),
          transform: `translateY(${(1 - enter) * 180 + exit * -40}px) rotateX(${(1 - enter) * 20 + exit * -8}deg) rotateY(${drift}deg) scale(${0.9 + enter * 0.1 - exit * 0.05})`,
        }}
      >
        <div style={{ height: BAR, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", background: "#1a1d27", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
          <div style={{ flex: 1, textAlign: "center", color: "#8b93b0", fontSize: 14, fontFamily: "-apple-system, sans-serif", marginRight: 52 }}>Ticketry</div>
        </div>
        <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
          <div style={{ width: SOURCE.width, height: SOURCE.height, transformOrigin: "0 0", transform: `scale(${SCALE}) translate(${SOURCE.width / 2}px, ${SOURCE.height / 2}px) scale(${cam.zoom}) translate(${-SOURCE.width / 2 - panX}px, ${-SOURCE.height / 2 - panY}px)` }}>
            {/* Scenes 1-4 are contiguous in the recording; the terminal scene skips the prompt setup. */}
            <Sequence durationInFrames={terminalCut} layout="none">
              <OffthreadVideo src={staticFile("tour.mp4")} startFrom={Math.round(SCENES[0].from * FPS)} muted style={{ width: SOURCE.width, height: SOURCE.height }} />
            </Sequence>
            <Sequence from={terminalCut} layout="none">
              <OffthreadVideo src={staticFile("tour.mp4")} startFrom={Math.round(SCENES[SCENES.length - 1].from * FPS)} muted style={{ width: SOURCE.width, height: SOURCE.height }} />
            </Sequence>
          </div>
          <div style={{ position: "absolute", inset: 0, background: "white", opacity: flash, pointerEvents: "none" }} />
        </div>
      </div>
      {SCENES.map((scene, i) => (
        <Sequence key={i} from={SCENE_STARTS[i]} durationInFrames={sceneFrames(scene)} layout="none">
          <Caption text={scene.caption} index={i} duration={sceneFrames(scene)} />
        </Sequence>
      ))}
    </div>
  );
};
