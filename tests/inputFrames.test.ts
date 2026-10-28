import { afterEach, expect, it, vi } from "vitest";
import { InputFrames } from "../src/inputFrames";
afterEach(() => vi.unstubAllGlobals());
it.each([90, 120, 144])(
  "coalesces %i Hz previews to 60 updates with no idle loop",
  (hz) => {
    let id = 0;
    const pending = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
    const frames = new InputFrames(),
      painted: number[] = [];
    for (let sample = 0; sample < hz; sample++) {
      frames.request(() => painted.push(sample));
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback((sample * 1000) / hz));
    }
    expect(painted.length).toBe(60);
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(1000));
    expect(painted.at(-1)).toBe(hz - 1);
    expect(pending.size).toBe(0);
    frames.request(() => {
      throw Error("canceled preview");
    });
    frames.cancel();
    expect(pending.size).toBe(0);
  },
);
