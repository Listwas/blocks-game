/** One pending snapshot and one write. Input handlers only replace a reference. */
export class SaveScheduler<T> {
  private pending: T | undefined;
  private job: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frame: number | undefined;
  private start: (() => void) | null = null;
  constructor(private write: (snapshot: T) => Promise<void>) {}
  save(value: T): Promise<void> {
    this.pending = value;
    if (!this.job) {
      this.job = new Promise<void>((resolve, reject) => {
        this.start = () => {
          this.start = null;
          void this.drain().then(resolve, reject);
        };
        const schedule = () => {
          this.timer = setTimeout(() => this.start?.(), 0);
        };
        if (typeof requestAnimationFrame === "function" && !document.hidden)
          this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            schedule();
          });
        else schedule();
      }).finally(() => {
        this.job = null;
      });
    }
    return this.job;
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.start?.();
    return this.job ?? Promise.resolve();
  }
  private async drain() {
    while (this.pending !== undefined) {
      const snapshot = structuredClone(this.pending);
      this.pending = undefined;
      await this.write(snapshot);
    }
  }
}
