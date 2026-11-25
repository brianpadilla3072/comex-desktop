import { Composition } from "remotion";
import { WebglScene } from "./Scene";

export const WebglRoot = () => (
  <Composition
    id="WebglCheck"
    component={WebglScene}
    durationInFrames={30}
    fps={30}
    width={640}
    height={360}
  />
);
