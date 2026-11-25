import { loadCustomTaskSound } from "./custom-sound-store";
import type { TaskSoundPreference } from "./task-sound-preference";

type BuiltInSound = Exclude<TaskSoundPreference, "off" | "custom">;

type Tone = {
  frequency: number;
  endFrequency?: number;
  offset: number;
  duration: number;
  type: OscillatorType;
  peak: number;
};

const BUILT_IN_SOUNDS: Record<BuiltInSound, Tone[]> = {
  chime: [
    { frequency: 880, offset: 0, duration: 0.36, type: "sine", peak: 0.16 },
    { frequency: 1318.51, offset: 0.11, duration: 0.36, type: "sine", peak: 0.14 },
  ],
  bell: [
    { frequency: 659.25, offset: 0, duration: 0.9, type: "sine", peak: 0.16 },
    { frequency: 1318.51, offset: 0, duration: 0.7, type: "sine", peak: 0.06 },
    { frequency: 1976.5, offset: 0.02, duration: 0.5, type: "sine", peak: 0.03 },
  ],
  pop: [
    { frequency: 520, endFrequency: 220, offset: 0, duration: 0.16, type: "sine", peak: 0.2 },
  ],
  marimba: [
    { frequency: 523.25, offset: 0, duration: 0.32, type: "triangle", peak: 0.16 },
    { frequency: 783.99, offset: 0.09, duration: 0.32, type: "triangle", peak: 0.13 },
  ],
  soft: [
    { frequency: 440, offset: 0, duration: 0.5, type: "sine", peak: 0.1 },
    { frequency: 587.33, offset: 0.16, duration: 0.5, type: "sine", peak: 0.09 },
  ],
};

let audioContext: AudioContext | null = null;
let customUrl: string | null = null;
let customPlayer: HTMLAudioElement | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  audioContext ??= new window.AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function playTone(context: AudioContext, tone: Tone, start: number): void {
  const at = start + tone.offset;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, at);
  if (tone.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, at + tone.duration);
  }
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(tone.peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + tone.duration + 0.02);
}

async function playCustomSound(): Promise<void> {
  const stored = await loadCustomTaskSound();
  if (!stored || typeof window === "undefined") return;
  if (customUrl) URL.revokeObjectURL(customUrl);
  customUrl = URL.createObjectURL(stored.blob);
  customPlayer ??= new Audio();
  customPlayer.src = customUrl;
  customPlayer.currentTime = 0;
  await customPlayer.play().catch(() => undefined);
}

/** Best-effort playback; a blocked device never fails the run. */
export function playTaskSound(kind: TaskSoundPreference): void {
  if (kind === "off") return;
  if (kind === "custom") {
    void playCustomSound();
    return;
  }
  const context = audio();
  if (!context) return;
  try {
    const start = context.currentTime;
    for (const tone of BUILT_IN_SOUNDS[kind]) playTone(context, tone, start);
  } catch {
    // Audio is a courtesy.
  }
}
