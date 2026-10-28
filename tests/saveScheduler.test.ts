import { expect, it, vi } from "vitest";
import { SaveScheduler } from "../src/core/saveScheduler";
it("coalesces input bursts and flushes the newest snapshot after an in-flight write", async () => {
  vi.useFakeTimers();
  const writes: { n: number }[] = [];
  let release: (() => void) | undefined;
  const writer = new SaveScheduler<{ n: number }>(async (value) => {
    writes.push(value);
    if (writes.length === 1) await new Promise<void>((r) => (release = r));
  });
  const value = { n: 0 };
  let done: Promise<void>;
  for (let n = 0; n < 100; n++) {
    value.n = n;
    done = writer.save(value);
  }
  expect(writes).toHaveLength(0);
  void writer.flush();
  expect(writes).toEqual([{ n: 99 }]);
  value.n = 100;
  writer.save(value);
  value.n = 101;
  writer.save(value);
  release!();
  await done!;
  expect(writes).toEqual([{ n: 99 }, { n: 101 }]);
  vi.useRealTimers();
});
it("allows retry after a failed write without retaining an unbounded queue", async () => {
  vi.useFakeTimers();
  let fail = true;
  const writes: number[] = [];
  const writer = new SaveScheduler<number>(async (value) => {
    if (fail) throw Error("disk full");
    writes.push(value);
  });
  const first = writer.save(1);
  void writer.flush().catch(() => {});
  await expect(first).rejects.toThrow("disk full");
  fail = false;
  const second = writer.save(2);
  void writer.flush();
  await second;
  expect(writes).toEqual([2]);
  vi.useRealTimers();
});

it("defers cloning until after a paint opportunity, but flush cancels that wait", async () => {
  vi.useFakeTimers();
  let frame: FrameRequestCallback | undefined;
  const cancel = vi.fn();
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 7;
  });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  try {
    const writes: number[] = [];
    const writer = new SaveScheduler<{ n: number }>(async (value) => {
      writes.push(value.n);
    });
    const value = { n: 1 },
      done = writer.save(value);
    vi.runAllTimers();
    expect(writes).toEqual([]);
    value.n = 2;
    frame!(0);
    expect(writes).toEqual([]);
    vi.runAllTimers();
    await done;
    expect(writes).toEqual([2]);
    writer.save({ n: 3 });
    await writer.flush();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(writes).toEqual([2, 3]);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
