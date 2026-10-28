type Settings = { effects: boolean; effectsVolume: number };
type Effect =
  | "start"
  | "place"
  | "fill"
  | "mark"
  | "erase"
  | "cross"
  | "clear"
  | "combo"
  | "reward"
  | "win"
  | "gameover"
  | "lose"
  | "mistake"
  | "tap";
const notes: Record<Effect, number[]> = {
  start: [523.25, 659.25, 783.99],
  place: [440],
  fill: [440],
  mark: [480],
  erase: [330],
  cross: [330],
  tap: [440],
  clear: [660, 830],
  combo: [660, 880, 1108],
  reward: [784, 988, 1175],
  win: [660, 880, 1108],
  gameover: [392, 294],
  lose: [392, 294],
  mistake: [520],
};
/** Effects have a deadline, never a playback queue. One buffer is one voice. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private buffers = new Map<Effect, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private pending: { kind: Effect; at: number } | null = null;
  private sleeping: ReturnType<typeof setTimeout> | undefined;
  private hidden = false;
  private disposed = false;
  private unlocked = false;
  private lastEffect = -Infinity;
  private lastKind: Effect | null = null;
  constructor(public preferences: Settings) {}
  private get enabled() {
    return (
      !this.disposed &&
      !this.hidden &&
      this.preferences.effects &&
      this.preferences.effectsVolume > 0
    );
  }
  unlock() {
    if (!this.enabled || (this.unlocked && !this.pending)) return;
    clearTimeout(this.sleeping);
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.output = this.context.createGain();
      this.output.gain.value = this.preferences.effectsVolume;
      this.output.connect(this.context.destination);
      const shared = new Map<string, AudioBuffer>();
      for (const [key, tones] of Object.entries(notes)) {
        const signature = `${key === "start" ? "start" : key === "mistake" ? "mistake" : "normal"}:${tones.join(",")}`;
        const cached = shared.get(signature);
        if (cached) {
          this.buffers.set(key as Effect, cached);
          continue;
        }
        const rate = this.context.sampleRate;
        const startup = key === "start";
        const duration = startup ? 0.16 : 0.12;
        const spacing = startup ? 0.075 : 0.045;
        const buffer = this.context.createBuffer(
          1,
          Math.ceil(rate * (duration + (tones.length - 1) * spacing)),
          rate,
        );
        const data = buffer.getChannelData(0);
        tones.forEach((frequency, n) => {
          const start = Math.floor(n * spacing * rate);
          for (let i = 0; i < rate * duration && start + i < data.length; i++) {
            const t = i / rate;
            const envelope =
              Math.min(1, t / 0.004) *
              Math.exp(-t * (startup ? 28 : 48)) *
              (startup ? Math.min(1, (duration - t) / 0.018) : 1);
            const phase = t * frequency * 2 * Math.PI;
            const tone =
              Math.sin(phase) + (startup ? 0.16 * Math.sin(phase * 2) : 0);
            data[start + i] += tone * envelope * (startup ? 0.085 : 0.1);
          }
        });
        shared.set(signature, buffer);
        this.buffers.set(key as Effect, buffer);
      }
    }
    if (this.context.state === "running") {
      this.unlocked = true;
      this.flush();
      this.idle();
      return;
    }
    // Call resume directly in each trusted gesture, including touch release on Safari.
    const pending = this.pending;
    void this.context
      .resume()
      .then(() => {
        if (!this.enabled) {
          this.cancel();
          void this.context?.suspend().catch(() => {});
          return;
        }
        this.unlocked = true;
        this.flush();
        this.idle();
      })
      .catch(() => {
        if (this.pending === pending) this.pending = null;
      });
  }
  effect(kind: Effect) {
    if (!this.enabled) return;
    const at = performance.now();
    if (kind === this.lastKind && at - this.lastEffect < 40) return;
    this.lastKind = kind;
    this.lastEffect = at;
    this.pending = { kind, at };
    this.unlock();
  }
  private flush() {
    const event = this.pending;
    this.pending = null;
    if (
      !event ||
      !this.enabled ||
      this.context?.state !== "running" ||
      performance.now() - event.at > 80
    )
      return;
    if (this.voices.size >= 4)
      this.stopVoice(this.voices.values().next().value!);
    const voice = this.context.createBufferSource();
    voice.buffer = this.buffers.get(event.kind)!;
    voice.connect(this.output!);
    this.voices.add(voice);
    voice.onended = () => {
      voice.disconnect();
      this.voices.delete(voice);
      if (!this.voices.size && this.enabled) this.idle();
    };
    voice.start();
  }
  private stopVoice(voice: AudioBufferSourceNode) {
    voice.onended = null;
    try {
      voice.stop();
    } catch {
      /* Already ended. */
    }
    voice.disconnect();
    this.voices.delete(voice);
  }
  private cancel() {
    this.pending = null;
    clearTimeout(this.sleeping);
    for (const voice of this.voices) this.stopVoice(voice);
  }
  private idle() {
    clearTimeout(this.sleeping);
    this.sleeping = setTimeout(() => {
      if (!this.voices.size) void this.context?.suspend().catch(() => {});
    }, 600);
  }
  setPreferences(preferences: Settings) {
    this.preferences = preferences;
    if (this.output && this.context)
      this.output.gain.setValueAtTime(
        preferences.effectsVolume,
        this.context.currentTime,
      );
    if (!this.enabled) {
      this.cancel();
      void this.context?.suspend().catch(() => {});
    }
  }
  background(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) {
      this.cancel();
      void this.context?.suspend().catch(() => {});
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    void this.context?.close().catch(() => {});
  }
}
