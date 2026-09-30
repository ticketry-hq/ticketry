import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, MONO } from "./TitleCard";

// Word-by-word caption for one scene; mounted inside that scene's Sequence.
export const Caption = ({ text, index, duration }: { text: string; index: number; duration: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [duration - 8, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", bottom: 64, width: "100%", display: "flex", justifyContent: "center", opacity: out, fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 30px", borderRadius: 18, background: "rgba(10,12,18,0.78)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", transform: `translateY(${(1 - spring({ frame, fps, config: { damping: 16 } })) * 40}px)` }}>
      <span style={{ fontFamily: MONO, fontSize: 22, color: "#9fb4ff", border: "1px solid #3d4a7a", borderRadius: 8, padding: "4px 10px", opacity: spring({ frame, fps }) }}>
        {String(index + 1).padStart(2, "0")}
      </span>
      <span style={{ fontSize: 42, fontWeight: 650, color: "white", letterSpacing: -1 }}>
        {text.split(" ").map((word, i) => {
          const s = spring({ frame: frame - 3 - i * 3, fps, config: { damping: 18 } });
          return (
            <span key={i} style={{ display: "inline-block", marginRight: 14, opacity: s, transform: `translateY(${(1 - s) * 24}px)`, filter: `blur(${(1 - s) * 6}px)` }}>
              {word}
            </span>
          );
        })}
      </span>
      </div>
    </div>
  );
};
