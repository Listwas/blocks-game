import { safeDeal, type Deal } from "./core/blocks";
import type { Request, Response } from "./dealer.worker";

type Input = Omit<Request, "id">;
type Job = { input: Request; done: (deal: Deal | null) => void };

/** One reusable worker; only a matching live request can publish a tray. */
export class Dealer {
  private worker: Worker | null = null;
  private job: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  constructor(
    private create = () =>
      new Worker(new URL("./dealer.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  request(input: Input, done: Job["done"]) {
    this.cancel();
    const id = ++this.sequence;
    this.job = { input: { ...input, id }, done };
    try {
      if (!this.worker) {
        const worker = this.create();
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<Response>) => {
          const job = this.job,
            response = event.data;
          if (
            this.worker !== worker ||
            !job ||
            response.id !== job.input.id ||
            response.runId !== job.input.runId ||
            response.revision !== job.input.revision
          )
            return;
          if ("deal" in response) this.finish(response.deal);
          else this.fallback();
        };
        worker.onerror = (event) => {
          event.preventDefault();
          if (this.worker === worker) this.fallback();
        };
      }
      this.timer = setTimeout(() => this.fallback(), 5000);
      this.worker.postMessage(this.job.input);
    } catch {
      this.fallback();
    }
    return () => {
      if (this.job?.input.id === id) this.cancel();
    };
  }
  private finish(deal: Deal | null) {
    const job = this.job;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.job = null;
    job?.done(deal);
  }
  private fallback() {
    const job = this.job;
    this.stopWorker();
    if (!job) return;
    let deal: Deal | null = null;
    try {
      deal = safeDeal(job.input.board, job.input.rng);
    } catch {
      /* Preserve the saved board for Retry. */
    }
    this.finish(deal);
  }
  cancel() {
    if (!this.job) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.job = null;
    this.stopWorker();
  }
  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
  }
  dispose() {
    this.cancel();
    this.stopWorker();
  }
}
