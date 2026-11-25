import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Caption, type CaptionLine } from "./components/Caption";
import { Fade } from "./components/Fade";
import { FocusLayer, type FocusStep } from "./components/Focus";
import { LowerThird } from "./components/LowerThird";
import { SfxTrack, type SfxCue } from "./components/SfxTrack";
import { VoiceTrack, type VoiceCue } from "./components/VoiceTrack";

export type StyleTokens = {
  palette?: string[];
  typography?: { display?: string; body?: string };
  motion?: { transitions?: string[] };
  options?: { voice?: boolean; captions?: boolean; lowerThird?: boolean; sfx?: boolean };
};

export type Beat = {
  id: string;
  time: number;
  scene: string;
  text?: string;
  motion?: string;
  transition?: string;
  focus?: FocusStep[];
  sfx?: SfxCue[];
  voice?: { line?: string; audio?: string; gainDb?: number };
};

export type CueSheet = {
  meta?: { durationSeconds?: number; fps?: number; aspect?: string };
  beats?: Beat[];
  captions?: CaptionLine[];
  lowerThird?: { name: string; title?: string };
};

export type VideoProps = {
  style: StyleTokens;
  cueSheet: CueSheet;
};

export const Video = ({ style, cueSheet }: VideoProps) => {
  const { fps } = useVideoConfig();
  const palette = Array.isArray(style.palette)
    ? style.palette.filter((color): color is string => typeof color === "string")
    : [];
  const background = palette[0] ?? "#0b0f19";
  const accent = palette[1] ?? "#2563eb";
  const foreground = palette[2] ?? "#f6f7f9";
  const display = style.typography?.display ?? "Inter";
  const beats = Array.isArray(cueSheet.beats) ? cueSheet.beats : [];
  const captions = Array.isArray(cueSheet.captions) ? cueSheet.captions : [];
  const sfx = beats.flatMap((beat) => (Array.isArray(beat.sfx) ? beat.sfx : []));
  const voice = beats.flatMap((beat): VoiceCue[] =>
    beat.voice?.audio
      ? [{ id: beat.id, at: beat.time, audio: beat.voice.audio, gainDb: beat.voice.gainDb }]
      : [],
  );
  const total = cueSheet.meta?.durationSeconds ?? 10;
  const lowerThird = cueSheet.lowerThird;
  const options = style.options ?? {};

  return (
    <AbsoluteFill style={{ backgroundColor: background, color: foreground, fontFamily: `${display}, sans-serif` }}>
      {beats.map((beat, index) => {
        const from = Math.max(0, Math.round(beat.time * fps));
        const next = beats[index + 1]?.time ?? total;
        const durationInFrames = Math.max(1, Math.round((next - beat.time) * fps));
        return (
          <Sequence key={beat.id} from={from} durationInFrames={durationInFrames}>
            <FocusLayer steps={beat.focus}>
              <Fade>
                <AbsoluteFill style={{ padding: 96, justifyContent: "center" }}>
                  <div style={{ width: 72, height: 8, background: accent, marginBottom: 32 }} />
                  <div style={{ fontSize: 84, lineHeight: 1.05, fontWeight: 700, maxWidth: "85%" }}>
                    {beat.text ?? beat.scene}
                  </div>
                </AbsoluteFill>
              </Fade>
            </FocusLayer>
          </Sequence>
        );
      })}
      {options.captions === false ? null : <Caption captions={captions} />}
      {options.lowerThird === false || !lowerThird ? null : <LowerThird name={lowerThird.name} title={lowerThird.title} accent={accent} />}
      {options.voice === false ? null : <VoiceTrack cues={voice} fps={fps} />}
      {options.sfx === false ? null : <SfxTrack cues={sfx} fps={fps} />}
    </AbsoluteFill>
  );
};
