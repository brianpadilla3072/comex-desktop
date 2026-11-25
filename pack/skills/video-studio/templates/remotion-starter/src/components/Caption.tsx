import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type CaptionLine = {
  from: number;
  to: number;
  text: string;
};

export const Caption = ({
  captions,
  color = "#ffffff",
  background = "rgba(0,0,0,0.68)",
  fontSize = 44,
}: {
  captions: CaptionLine[];
  color?: string;
  background?: string;
  fontSize?: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const active = captions.find((line) => time >= line.from && time < line.to);
  if (!active) return null;

  const opacity = interpolate(
    time,
    [active.from, active.from + 0.12, active.to - 0.12, active.to],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: 72 }}>
      <div
        style={{
          opacity,
          background,
          color,
          padding: "12px 24px",
          borderRadius: 12,
          fontSize,
          fontWeight: 700,
          lineHeight: 1.2,
          textAlign: "center",
          maxWidth: "86%",
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};
