import { useCurrentFrame } from "remotion";
import { ThreeCanvas } from "@remotion/three";

/**
 * Escena mínima para verificar que WebGL funciona en el Chromium headless de
 * Remotion. Si esto sale negro, ninguna escena 3D va a renderizar y hay que
 * volver a capas SVG.
 */
export const WebglScene = () => {
  const frame = useCurrentFrame();
  return (
    <ThreeCanvas
      width={640}
      height={360}
      camera={{ position: [0, 0.6, 4.2], fov: 45 }}
      style={{ backgroundColor: "#101418" }}
    >
      <color attach="background" args={["#101418"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} />
      <mesh rotation={[0.35, frame / 18, 0]}>
        <boxGeometry args={[1.4, 1.4, 1.4]} />
        <meshStandardMaterial color="#fcd03d" />
      </mesh>
      <mesh position={[0, -1.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#54654b" />
      </mesh>
    </ThreeCanvas>
  );
};
