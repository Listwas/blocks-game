import { expect, it, vi } from "vitest";
import { Dealer } from "../src/dealer";
import { safeDeal, verifyWitness } from "../src/core/blocks";
import type { Request } from "../src/dealer.worker";
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  postMessage = vi.fn<(request: Request) => void>();
  terminate = vi.fn();
  respond(input: Request, deal = safeDeal(input.board, input.rng)) {
    this.onmessage?.({ data: { ...input, deal } });
  }
}
const input = {
  runId: "run-a",
  revision: 3,
  board: Array(64).fill(0),
  rng: 13,
};
function client() {
  const workers: FakeWorker[] = [];
  const dealer = new Dealer(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  return { dealer, workers };
}
it("reuses a worker, rejecting stale, mismatched and duplicate responses", () => {
  const { dealer, workers } = client(),
    first = vi.fn(),
    second = vi.fn();
  const oldCancel = dealer.request(input, first),
    worker = workers[0];
  const a = worker.postMessage.mock.calls[0][0];
  worker.respond(a);
  worker.respond(a);
  expect(first).toHaveBeenCalledTimes(1);
  expect(worker.terminate).not.toHaveBeenCalled();
  dealer.request({ ...input, revision: 4 }, second);
  oldCancel();
  const b = worker.postMessage.mock.calls[1][0];
  worker.respond(a);
  worker.respond({ ...b, runId: "old-run" });
  worker.respond({ ...b, revision: 3 });
  expect(second).not.toHaveBeenCalled();
  worker.respond(b);
  expect(second).toHaveBeenCalledTimes(1);
  expect(workers).toHaveLength(1);
  dealer.dispose();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it("cancels busy work and ignores its reply after a new run starts", () => {
  const { dealer, workers } = client(),
    old = vi.fn(),
    next = vi.fn();
  const cancel = dealer.request(input, old),
    first = workers[0],
    pending = first.postMessage.mock.calls[0][0];
  cancel();
  expect(first.terminate).toHaveBeenCalledTimes(1);
  dealer.request({ ...input, runId: "run-b" }, next);
  first.respond(pending);
  expect(old).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  const second = workers[1];
  second.respond(second.postMessage.mock.calls[0][0]);
  expect(next).toHaveBeenCalledTimes(1);
  dealer.dispose();
});
it("uses a verified fallback after failure and can start a new worker", () => {
  const { dealer, workers } = client(),
    done = vi.fn();
  dealer.request(input, done);
  workers[0].onerror?.({ preventDefault() {} });
  const deal = done.mock.calls[0][0];
  expect(deal.fallback).toBe(true);
  expect(verifyWitness(input.board, deal.tray, deal.witness)).toBe(true);
  dealer.request({ ...input, revision: 4 }, vi.fn());
  expect(workers).toHaveLength(2);
  dealer.dispose();
});
it("bounds waiting and does not deliver anything after disposal", () => {
  vi.useFakeTimers();
  try {
    const { dealer, workers } = client(),
      done = vi.fn();
    dealer.request(input, done);
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledTimes(1);
    dealer.request(input, done);
    dealer.dispose();
    workers[1].respond(workers[1].postMessage.mock.calls[0][0]);
    vi.runAllTimers();
    expect(done).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("handles construction failure without leaving pending work", () => {
  const dealer = new Dealer(() => {
      throw Error("unavailable");
    }),
    done = vi.fn();
  dealer.request(input, done);
  expect(done.mock.calls[0][0].fallback).toBe(true);
  dealer.dispose();
});
