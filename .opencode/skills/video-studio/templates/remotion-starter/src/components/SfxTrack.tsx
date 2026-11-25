import { Audio, Sequence } from "remotion";

export type SfxCue = {
  asset?: string;
  at?: number;
  gainDb?: number;
  label?: string;
};

export const SfxTrack = ({ cues, fps }: { cues: SfxCue[]; fps: number }) => {
  return (
    <>
      {cues.map((cue, index) => {
        if (!cue.asset) return null;
        return (
          <Sequence key={`sfx-${index}`} from={Math.max(0, Math.round((cue.at ?? 0) * fps))}>
            <Audio
              src={cue.asset}
              volume={Math.pow(10, (cue.gainDb ?? 0) / 20)}
            />
          </Sequence>
        );
      })}
    </>
  );
};
