import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { ReactNode } from "react";

export const Fade = ({
  children,
  durationInFrames = 10,
}: {
  children: ReactNode;
  durationInFrames?: number;
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
