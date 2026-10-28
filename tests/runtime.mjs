import assert from "node:assert/strict";
import { harness } from "./support.mjs";
const h = await harness();
let checks = 0;
const check = (ok, label) => {
  assert(ok, label);
  checks++;
  console.log("PASS", label);
};
try {
  const context = await h.browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.soundMetrics = {
      contexts: [],
      starts: 0,
      active: 0,
      maxActive: 0,
      peak: 0,
    };
    window.AudioContext = new Proxy(Real, {
      construct(target, args) {
        const ctx = new target(...args);
        window.soundMetrics.contexts.push(ctx);
        return ctx;
      },
    });
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      if (args[0] === this.context.destination) {
        const meter = this.context.createAnalyser();
        meter.fftSize = 256;
        connect.call(this, meter);
        connect.call(meter, this.context.destination);
        const data = new Float32Array(256);
        setInterval(() => {
          meter.getFloatTimeDomainData(data);
          window.soundMetrics.peak = Math.max(
            window.soundMetrics.peak,
            ...data.map(Math.abs),
          );
        }, 5);
        return args[0];
      }
      return connect.apply(this, args);
    };
    const start = AudioBufferSourceNode.prototype.start,
      stop = AudioBufferSourceNode.prototype.stop;
    const active = new WeakSet();
    const end = (node) => {
      if (active.delete(node)) window.soundMetrics.active--;
    };
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.soundMetrics.starts++;
      window.soundMetrics.active++;
      active.add(this);
      window.soundMetrics.maxActive = Math.max(
        window.soundMetrics.maxActive,
        window.soundMetrics.active,
      );
      this.addEventListener("ended", () => end(this), { once: true });
      return start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      end(this);
      return stop.apply(this, args);
    };
  });
  await page.goto(h.base + "/__test__/effects.html");
  await page.evaluate(async () => {
    const { AudioEngine } = await import("/__test__/audio.js");
    window.audio = new AudioEngine({ effects: true, effectsVolume: 1 });
    document.querySelector("button").onclick = () =>
      window.audio.effect("place");
    document.addEventListener("touchend", () => window.audio.unlock());
  });
  await page.getByRole("button", { name: "Play effect" }).tap();
  await page.waitForFunction(
    () => window.soundMetrics.peak > 0.00005,
    {},
    { timeout: 4000 },
  );
  check(true, "first trusted touch produces real PCM");
  await page.waitForTimeout(1700);
  check(
    await page.evaluate(() =>
      window.soundMetrics.contexts.every((c) => c.state === "suspended"),
    ),
    "idle context suspends",
  );
  await page.evaluate(() => (window.soundMetrics.peak = 0));
  await page.getByRole("button", { name: "Play effect" }).tap();
  await page.waitForFunction(
    () => window.soundMetrics.peak > 0.00005,
    {},
    { timeout: 4000 },
  );
  check(true, "first effect after idle is audible");
  await page.waitForTimeout(250);
  let before = await page.evaluate(() => window.soundMetrics.starts);
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) window.audio.effect("place");
  });
  await page.waitForTimeout(300);
  check(
    (await page.evaluate(() => window.soundMetrics.starts)) - before <= 1,
    "100 immediate repeated calls do not build a playback queue",
  );
  before = await page.evaluate(() => window.soundMetrics.starts);
  await page.waitForTimeout(1100);
  check(
    (await page.evaluate(() => window.soundMetrics.starts)) === before,
    "no delayed burst after input stops",
  );
  await page.getByRole("button", { name: "Play effect" }).tap();
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++)
      window.audio.effect(i % 2 ? "clear" : "mistake");
  });
  check(
    await page.evaluate(() => window.soundMetrics.maxActive <= 4),
    "at most four concurrent effect voices",
  );
  await page.evaluate(() =>
    window.audio.setPreferences({ effects: false, effectsVolume: 1 }),
  );
  await page.waitForTimeout(50);
  check(
    await page.evaluate(
      () =>
        window.soundMetrics.active === 0 &&
        window.soundMetrics.contexts.every((c) => c.state === "suspended"),
    ),
    "mute stops active voices and context",
  );
  before = await page.evaluate(() => window.soundMetrics.starts);
  await page.getByRole("button", { name: "Play effect" }).tap();
  check(
    (await page.evaluate(() => window.soundMetrics.starts)) === before,
    "muted inputs emit no sound",
  );
  await page.evaluate(() => {
    window.audio.setPreferences({ effects: true, effectsVolume: 0 });
    window.audio.effect("clear");
  });
  check(
    (await page.evaluate(() => window.soundMetrics.starts)) === before,
    "zero volume emits no voices",
  );
  await page.evaluate(() =>
    window.audio.setPreferences({ effects: true, effectsVolume: 1 }),
  );
  await page.getByRole("button", { name: "Play effect" }).tap();
  await page.evaluate(() => window.audio.background(true));
  await page.waitForTimeout(50);
  check(
    await page.evaluate(
      () =>
        window.soundMetrics.active === 0 &&
        window.soundMetrics.contexts.every((c) => c.state === "suspended"),
    ),
    "background immediately cancels audio",
  );
  await page.evaluate(() => {
    window.audio.background(false);
    window.soundMetrics.peak = 0;
  });
  await page.getByRole("button", { name: "Play effect" }).tap();
  await page.waitForFunction(
    () => window.soundMetrics.peak > 0.00005,
    {},
    { timeout: 4000 },
  );
  check(true, "foreground gesture recovers audio");
  await page.evaluate(() => window.audio.dispose());
  console.log(`${checks} ${h.engine} audio runtime checks passed`);
} finally {
  await h.close();
}
