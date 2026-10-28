/** Latest preview only, capped at 60 updates/second; no frames while idle. */
export class InputFrames {
  private frame = 0;
  private next = -Infinity;
  private latest: (() => void) | null = null;
  request(paint: () => void) {
    this.latest = paint;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (at: number) => {
    this.frame = 0;
    if (!this.latest) return;
    const interval = 1000 / 60;
    if (at + 0.5 < this.next) {
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    const paint = this.latest;
    this.latest = null;
    this.next =
      at - this.next > interval ? at + interval : this.next + interval;
    paint();
  };
  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.latest = null;
    this.next = -Infinity;
  }
}
