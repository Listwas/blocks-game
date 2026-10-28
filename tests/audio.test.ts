import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../src/audio";
let context: FakeContext;
class FakeContext {
  state = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  sources: any[] = [];
  resolves: (() => void)[] = [];
  constructor() {
    context = this;
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {} }, connect() {} };
  }
  createBuffer(_: number, size: number) {
    return { getChannelData: () => new Float32Array(size) };
  }
  createBufferSource() {
    const s = {
      buffer: null,
      onended: null,
      connect() {},
      disconnect() {},
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(s);
    return s;
  }
  resume() {
    return new Promise<void>((r) => this.resolves.push(r));
  }
  wake() {
    this.state = "running";
    this.resolves.splice(0).forEach((r) => r());
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("bounded effects", () => {
  it("drops stale sounds instead of draining a gesture backlog", async () => {
    const audio = new AudioEngine({ effects: true, effectsVolume: 1 });
    for (let i = 0; i < 20; i++) {
      audio.effect("place");
      vi.advanceTimersByTime(45);
    }
    vi.advanceTimersByTime(100);
    context.wake();
    await Promise.resolve();
    expect(context.sources).toHaveLength(0);
    audio.effect("clear");
    expect(context.sources).toHaveLength(1);
    audio.dispose();
  });
  it("retains at most the latest fresh sound during resume", async () => {
    const audio = new AudioEngine({ effects: true, effectsVolume: 1 });
    audio.effect("place");
    vi.advanceTimersByTime(45);
    audio.effect("clear");
    context.wake();
    await Promise.resolve();
    expect(context.sources).toHaveLength(1);
    audio.dispose();
  });
  it("coalesces bursts, limits voices and stops on mute/background", () => {
    const audio = new AudioEngine({ effects: true, effectsVolume: 1 });
    audio.unlock();
    context.state = "running";
    for (let i = 0; i < 100; i++) audio.effect("place");
    expect(context.sources).toHaveLength(1);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(45);
      audio.effect("place");
    }
    expect(
      context.sources.filter((s) => !s.stop.mock.calls.length),
    ).toHaveLength(4);
    audio.background(true);
    expect(context.sources.every((s) => s.stop.mock.calls.length === 1)).toBe(
      true,
    );
    audio.background(false);
    audio.effect("clear");
    audio.setPreferences({ effects: false, effectsVolume: 1 });
    context.wake();
    expect(context.sources).toHaveLength(9);
    audio.dispose();
  });
});
it("a late resume cannot reactivate a muted/background context", async () => {
  const audio = new AudioEngine({ effects: true, effectsVolume: 1 });
  audio.effect("place");
  audio.background(true);
  context.wake();
  await Promise.resolve();
  expect(context.state).toBe("suspended");
  expect(context.sources).toHaveLength(0);
  audio.dispose();
});

it("silent gestures cannot wake an unlocked idle context", async () => {
  const audio = new AudioEngine({ effects: true, effectsVolume: 1 });
  audio.unlock();
  context.wake();
  await Promise.resolve();
  vi.advanceTimersByTime(1600);
  expect(context.state).toBe("suspended");
  for (let i = 0; i < 100; i++) audio.unlock();
  expect(context.resolves).toHaveLength(0);
  expect(context.state).toBe("suspended");
  audio.effect("place");
  expect(context.resolves).toHaveLength(1);
  context.wake();
  await Promise.resolve();
  expect(context.sources).toHaveLength(1);
  audio.effect("fill");
  expect(context.sources[0].buffer).toBe(context.sources[1].buffer);
  audio.dispose();
});

it("suspends shortly after the last voice ends without cutting it off", async () => {
  const audio = new AudioEngine({ effects: true, effectsVolume: 1 });
  audio.effect("place");
  context.wake();
  await Promise.resolve();
  vi.advanceTimersByTime(600);
  expect(context.state).toBe("running");
  context.sources[0].onended!();
  vi.advanceTimersByTime(599);
  expect(context.state).toBe("running");
  vi.advanceTimersByTime(1);
  expect(context.state).toBe("suspended");
  audio.dispose();
});
