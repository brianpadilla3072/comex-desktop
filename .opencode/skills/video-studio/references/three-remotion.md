# 3D real con @remotion/three

Leé esto cuando el brief pida 3D o cuando la referencia sea una escena
renderizada (low-poly, producto, habitación). Si no, quedate en capas SVG: es
más rápido y no depende de WebGL.

## Primero: verificar que este equipo puede

```bash
node .opencode/skills/video-studio/scripts/check-webgl.mjs video-projects/<slug>
```

Monta un cubo mínimo, renderiza un still y mide la imagen. Si sale `ok: true`,
WebGL funciona en el Chromium headless y podés usar Three.js. Si sale
`ok: false` con `stdev` bajo, el canvas está negro: volvé a 2.5D con SVG y
anotá el motivo en `style.md`. No escribas escenas 3D antes de este chequeo.

El chequeo deja `remotion/.webgl-check/frame.png` para mirar con visión. Un
cubo con caras de distinto tono es la señal de que hay luz y cámara; un
rectángulo plano del color del fondo es una escena sin renderizar.

## Versiones

`remotion`, `@remotion/three` y `@remotion/renderer` tienen que estar en la
**misma versión exacta**. Un rango `^4.0.0` puede resolver distinto y el render
falla sin decir por qué. Instalá con la versión que ya tiene el proyecto:

```bash
cd video-projects/<slug>/remotion
npm install @remotion/three@$(node -p "require('remotion/package.json').version") three @react-three/fiber
```

`@react-three/fiber` 9.x es el que va con React 19.

## Estructura

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";

export const Room = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} camera={{ position: [0, 1.2, 4], fov: 42 }}>
      <color attach="background" args={["#1c2024"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={2} />
      {/* ... */}
    </ThreeCanvas>
  );
};
```

## Reglas que evitan retrabajo

- **El texto nunca va dentro del canvas.** Un `<mesh>` con texto 3D es ilegible
  a 1080 de ancho y no se puede editar. El canvas es la escena; el caption, el
  HUD y el CTA son capas de Remotion encima, como en 2D.
- **La cámara se anima en la escena, no con CSS.** `useCurrentFrame()` mueve
  `camera.position` o el grupo; escalar el div con `transform` aplana la
  perspectiva y se nota.
- **Look flat-shaded**: `meshStandardMaterial` con colores planos,
  `flatShading` en geometrías con volumen, una luz ambiental y una direccional.
  Nada de texturas fotorrealistas si la referencia es low-poly.
- **Sombras**: `castShadow`/`receiveShadow` cuesta caro por frame. Para un
  personaje chico, una elipse oscura debajo resuelve mejor y es determinística.
- **Imágenes**: `staticFile("assets/3d/textura.png")`; el `src` relativo no
  resuelve. Si cargás una textura, envolvé con `delayRender`/`continueRender`.
- **Costo**: en CPU (sin GPU) cada frame 3D tarda más que uno SVG. Medí un
  still antes de comprometer 900 frames; si un still tarda >2 s, bajá
  geometría o volvé a 2.5D.

## Qué gana contra 2.5D

Push-in y pull-out reales, paralaje entre planos a distinta profundidad, luz
direccional que cambia con el movimiento y sombras proyectadas. En 2.5D eso se
imita con escala y capas; funciona, pero la cámara no atraviesa la escena.

## Cuándo NO usarlo

- Referencia 2D plana (cartoon, collage, papel): el 3D no suma y agrega riesgo.
- 900 frames con geometría media en CPU: el render se va a minutos por minuto
  de video; si hay que iterar, es inviable.
- Cuando el equipo no pasa `check-webgl`: no hay plan B dentro de Three.js.
