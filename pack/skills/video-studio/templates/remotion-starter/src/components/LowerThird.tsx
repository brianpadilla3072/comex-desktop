import { AbsoluteFill } from "remotion";

export const LowerThird = ({
  name,
  title,
  accent = "#2563eb",
  background = "rgba(0,0,0,0.72)",
  color = "#ffffff",
}: {
  name: string;
  title?: string;
  accent?: string;
  background?: string;
  color?: string;
}) => {
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: 64 }}>
      <div
        style={{
          borderLeft: `8px solid ${accent}`,
          background,
          color,
          padding: "10px 18px",
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
        {title ? <div style={{ fontSize: 22, opacity: 0.8 }}>{title}</div> : null}
      </div>
    </AbsoluteFill>
  );
};
