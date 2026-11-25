import { Audio, Sequence, staticFile } from "remotion";

export type VoiceCue = {
  id: string;
  at: number;
  audio: string;
  gainDb?: number;
};

export const VoiceTrack = ({ cues, fps }: { cues: VoiceCue[]; fps: number }) => {
  return (
    <>
      {cues.map((cue) => (
        <Sequence key={cue.id} from={Math.max(0, Math.round(cue.at * fps))}>
          <Audio
            src={staticFile(cue.audio)}
            volume={Math.pow(10, (cue.gainDb ?? 0) / 20)}
          />
        </Sequence>
      ))}
    </>
  );
};
