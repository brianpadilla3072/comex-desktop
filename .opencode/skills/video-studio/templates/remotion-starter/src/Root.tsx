import { Composition } from "remotion";
import cueSheetJson from "../../cue-sheet.json";
import styleJson from "../../style.json";
import { Video } from "./Video";

const format = styleJson.format;
const aspect = format?.aspect ?? cueSheetJson.meta?.aspect ?? "16:9";
const resolution = format?.resolution;
const width = resolution?.[0] ?? (aspect === "9:16" ? 1080 : aspect === "1:1" ? 1080 : 1920);
const height = resolution?.[1] ?? (aspect === "9:16" ? 1920 : 1080);
const fps = format?.fps ?? cueSheetJson.meta?.fps ?? 30;
const durationInFrames = Math.max(1, Math.round((cueSheetJson.meta?.durationSeconds ?? 10) * fps));

export const RemotionRoot = () => {
  return (
    <Composition
      id="Video"
      component={Video}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
      defaultProps={{ style: styleJson, cueSheet: cueSheetJson }}
    />
  );
};
