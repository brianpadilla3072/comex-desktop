import type { ReactNode } from "react";
import { AbsoluteFill, Easing, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Un paso de foco: "acercate a este punto en este segundo".
 * `at` es relativo al inicio de la escena (dentro de un <Sequence> el frame
 * arranca en 0, así que no hay que sumar el tiempo de la escena).
 */
export type FocusStep = {
  at: number;
  x?: number;
  y?: number;
  scale?: number;
  duration?: number;
  ease?: "out" | "in" | "inOut" | "linear";
};

const EASE: Record<NonNullable<FocusStep["ease"]>, (input: number) => number> = {
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  linear: Easing.linear,
};

export type FocusState = { x: number; y: number; scale: number };

/**
 * Estado de la cámara en un segundo dado. Cada paso interpola desde el estado
 * anterior, así que un paso puede cambiar solo `scale` y conservar el punto.
 */
export const sampleFocus = (
  steps: FocusStep[],
  seconds: number,
  width: number,
  height: number,
): FocusState => {
  const sorted = [...steps].sort((a, b) => a.at - b.at);
  let current: FocusState = { x: width / 2, y: height / 2, scale: 1 };

  for (const step of sorted) {
    const target: FocusState = {
      x: step.x ?? current.x,
      y: step.y ?? current.y,
      scale: step.scale ?? current.scale,
    };
    const duration = Math.max(0.001, step.duration ?? 0.55);

    if (seconds >= step.at + duration) {
      current = target;
      continue;
    }
    if (seconds <= step.at) return current;

    const progress = EASE[step.ease ?? "out"]((seconds - step.at) / duration);
    return {
      x: current.x + (target.x - current.x) * progress,
      y: current.y + (target.y - current.y) * progress,
      scale: current.scale + (target.scale - current.scale) * progress,
    };
  }

  return current;
};

/**
 * Capa de foco: envuelve SOLO el contenido de la escena.
 * Lo que quede afuera (caption, HUD, lower third) no se mueve con el zoom.
 */
export const FocusLayer = ({
  steps,
  children,
}: {
  steps?: FocusStep[];
  children: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  if (!steps || !steps.length) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const state = sampleFocus(steps, frame / fps, width, height);
  // Zoom alrededor del punto con origen en 0,0: el punto queda fijo y el
  // resto del cuadro se abre desde ahí (sin la deriva del origen centrado).
  const translateX = state.x * (1 - state.scale);
  const translateY = state.y * (1 - state.scale);

  return (
    <AbsoluteFill
      style={{
        transformOrigin: "0 0",
        transform: `translate(${translateX}px, ${translateY}px) scale(${state.scale})`,
        willChange: "transform",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
