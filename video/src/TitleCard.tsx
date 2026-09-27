import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const FONT = "'SF Pro Display', -apple-system, 'Helvetica Neue', sans-serif";
export const MONO = "'SF Mono', 'JetBrains Mono', ui-monospace, monospace";

export const TitleCard = ({ title, lines, fadeOutAt }: { title: string; lines: string[]; fadeOutAt?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = fadeOutAt === undefined ? 1 : interpolate(frame, [fadeOutAt, fadeOutAt + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out, fontFamily: FONT, color: "white" }}>
      <div style={{ display: "flex", fontSize: 150, fontWeight: 700, letterSpacing: -4 }}>
        {title.split("").map((ch, i) => {
          const s = spring({ frame: frame - i * 2.5, fps, config: { damping: 14, mass: 0.6 } });
          return (
            <span key={i} style={{ display: "inline-block", opacity: s, transform: `translateY(${(1 - s) * 60}px) rotateX(${(1 - s) * 80}deg)`, background: "linear-gradient(180deg,#fff 30%,#9fb4ff)", WebkitBackgroundClip: "text", color: "transparent" }}>
              {ch}
            </span>
          );
        })}
      </div>
      {lines.map((line, i) => {
        const s = spring({ frame: frame - 22 - i * 8, fps, config: { damping: 200 } });
        return (
          <div key={line} style={{ marginTop: i === 0 ? 24 : 10, fontFamily: MONO, fontSize: i === 0 ? 36 : 24, color: i === 0 ? "#c9d4ff" : "#7d86a8", opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
            {line}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
