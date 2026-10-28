import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { harness } from "./support.mjs";
const dir = await mkdtemp(tmpdir() + "/blocks-perf-");
await build({
  entryPoints: ["src/core/blocks.ts", "src/core/run.ts", "src/core/profile.ts"],
  outdir: dir,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
});
const core = await import(pathToFileURL(dir + "/blocks.mjs"));
const runs = await import(pathToFileURL(dir + "/run.mjs"));
const profiles = await import(pathToFileURL(dir + "/profile.mjs"));
const h = await harness();
function summary(values) {
  values.sort((a, b) => a - b);
  return {
    count: values.length,
    median: values[Math.floor(values.length * 0.5)] ?? 0,
    p95: values[Math.floor(values.length * 0.95)] ?? 0,
    max: values.at(-1) ?? 0,
  };
}
try {
  const context = await h.browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  try {
    await context.addInitScript(() => {
      window.perf = {
        workers: 0,
        terminated: 0,
        jobs: [],
        frames: [],
        handlers: [],
        longTasks: [],
      };
      const listeners = new Set(),
        listenerIds = new WeakMap();
      let nextListener = 0;
      const listenerKey = (target, type, callback, options) => {
        if ((target !== window && target !== document) || !callback)
          return null;
        if (!listenerIds.has(callback))
          listenerIds.set(callback, ++nextListener);
        return `${target === window ? "window" : "document"}:${type}:${typeof options === "boolean" ? options : !!options?.capture}:${listenerIds.get(callback)}`;
      };
      const add = EventTarget.prototype.addEventListener,
        remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (
        type,
        callback,
        options,
      ) {
        const key = listenerKey(this, type, callback, options);
        if (key) listeners.add(key);
        return add.call(this, type, callback, options);
      };
      EventTarget.prototype.removeEventListener = function (
        type,
        callback,
        options,
      ) {
        const key = listenerKey(this, type, callback, options);
        if (key) listeners.delete(key);
        return remove.call(this, type, callback, options);
      };
      const timeouts = new Set(),
        intervals = new Set();
      const timeout = window.setTimeout,
        interval = window.setInterval;
      const clearTimeoutNative = window.clearTimeout,
        clearIntervalNative = window.clearInterval;
      window.setTimeout = (callback, delay, ...args) => {
        if (typeof callback !== "function")
          return timeout(callback, delay, ...args);
        const id = timeout(() => {
          timeouts.delete(id);
          callback(...args);
        }, delay);
        timeouts.add(id);
        return id;
      };
      window.clearTimeout = (id) => {
        timeouts.delete(id);
        intervals.delete(id);
        clearTimeoutNative(id);
      };
      window.setInterval = (...args) => {
        const id = interval(...args);
        intervals.add(id);
        return id;
      };
      window.clearInterval = (id) => {
        intervals.delete(id);
        timeouts.delete(id);
        clearIntervalNative(id);
      };
      window.readLeaks = () => ({
        listeners: listeners.size,
        timeouts: timeouts.size,
        intervals: intervals.size,
      });
      window.perf.leaks = [];
      const Real = window.Worker;
      window.Worker = class extends Real {
        constructor(...args) {
          super(...args);
          window.perf.workers++;
          this.addEventListener("message", () => {
            window.perf.jobs.push(performance.now() - this.at);
          });
        }
        postMessage(...args) {
          this.at = performance.now();
          return super.postMessage(...args);
        }
        terminate() {
          window.perf.terminated++;
          return super.terminate();
        }
      };
      if (PerformanceObserver.supportedEntryTypes?.includes("longtask"))
        new PerformanceObserver((list) =>
          window.perf.longTasks.push(
            ...list.getEntries().map((e) => e.duration),
          ),
        ).observe({ type: "longtask" });
      document.addEventListener(
        "pointerup",
        (e) => {
          if (
            !document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest("[data-cell]")
          )
            return;
          const at = performance.now(),
            before = document.querySelector("[data-score]")?.textContent;
          const record = (frame) =>
            window.perf.frames.push({
              at,
              frame,
              ms: performance.now() - at,
              changed:
                document.querySelector("[data-score]")?.textContent !== before,
            });
          window.perf.inputAt = at;
          requestAnimationFrame(() => {
            record(1);
            requestAnimationFrame(() => record(2));
          });
        },
        true,
      );
      document.addEventListener("pointerup", () => {
        if (window.perf.inputAt) {
          window.perf.handlers.push(performance.now() - window.perf.inputAt);
          window.perf.inputAt = 0;
        }
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(h.base + "/__test__/effects.html");
    let profile = profiles.freshProfile();
    // A progressed board exercises Continue in both the old and corrected app.
    profile.active = runs.newRun(1831);
    profile.active = runs.acceptDeal(
      profile.active,
      core.dealTray(profile.active.board, profile.active.rng),
    );
    const first = profile.active.deals.at(-1).deal.witness[0];
    profile.active = runs.commit(
      profile.active,
      first.slot,
      first.row,
      first.col,
    ).run;
    await page.evaluate(
      (p) =>
        new Promise((resolve, reject) => {
          const q = indexedDB.open("blocks-profile", 1);
          q.onupgradeneeded = () => q.result.createObjectStore("profile");
          q.onerror = () => reject(q.error);
          q.onsuccess = () => {
            const tx = q.result.transaction("profile", "readwrite");
            tx.objectStore("profile").put(p, "current");
            tx.oncomplete = () => {
              q.result.close();
              resolve();
            };
          };
        }),
      profile,
    );
    await page.goto(h.base);
    await page.getByRole("button", { name: /^Continue/ }).tap();
    const read = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const q = indexedDB.open("blocks-profile", 1);
            q.onsuccess = () => {
              const db = q.result,
                tx = db.transaction("profile"),
                r = tx.objectStore("profile").get("current");
              r.onsuccess = () => {
                db.close();
                resolve(r.result);
              };
            };
          }),
      );
    async function saved(test) {
      for (let i = 0; i < 250; i++) {
        const p = await read();
        if (test(p)) return p;
        await page.waitForTimeout(20);
      }
      throw Error("Save/deal timed out");
    }
    let moves = profile.active.moves;
    for (let tray = 0; tray < 50; tray++) {
      if (tray % 5 === 0) {
        await page.getByRole("button", { name: "Menu", exact: true }).tap();
        await page.getByRole("button", { name: /^Continue/ }).tap();
        await page.waitForTimeout(40);
        await page.evaluate(() => window.perf.leaks.push(window.readLeaks()));
      }
      const deal = profile.active.deals.at(-1).deal;
      const steps = deal.witness.filter(
        (step) => profile.active.tray[step.slot],
      );
      for (const step of steps) {
        await page.locator(`[data-slot="${step.slot}"]`).tap();
        await page
          .locator(`[data-cell="${step.row * 8 + step.col}"]`)
          .tap({ force: true });
        moves++;
        profile = await saved((p) => p.active.moves === moves);
      }
      profile = await saved(
        (p) => p.active.phase === "playing" && p.active.tray.every(Boolean),
      );
      assert(
        core.verifyWitness(
          profile.active.board,
          profile.active.tray,
          profile.active.deals.at(-1).deal.witness,
        ),
      );
    }
    await page.waitForTimeout(100);
    const perf = await page.evaluate(() => window.perf);
    const timings = new Map();
    for (const frame of perf.frames) {
      if (frame.changed && !timings.has(frame.at))
        timings.set(frame.at, frame.ms);
    }
    const output = {
      engine: h.engine,
      refills: 50,
      homeCycles: 10,
      moves,
      workers: perf.workers,
      terminated: perf.terminated,
      placement: summary([...timings.values()]),
      handler: summary(perf.handlers),
      refill: summary(perf.jobs),
      longTasks: summary(perf.longTasks),
      lifecycleResources: perf.leaks,
      missedFirstTwoFrames: perf.frames.filter(
        (f) => f.frame === 2 && !f.changed,
      ).length,
    };
    assert.deepEqual(errors, []);
    if (process.env.PERF_ASSERT) {
      assert.equal(perf.workers, 1);
      assert.equal(output.missedFirstTwoFrames, 0);
      assert.equal(perf.jobs.length, 50);
      assert(
        perf.leaks.every(
          (sample) => sample.listeners === perf.leaks[0].listeners,
        ),
        "global listeners stay constant over Home/Continue cycles",
      );
      assert(
        perf.leaks.every(
          (sample) => sample.intervals === 1 && sample.timeouts <= 3,
        ),
        "one playtime interval and bounded transient timers",
      );
    }
    console.log(JSON.stringify(output, null, 2));
    if (process.env.PERF_OUTPUT)
      await writeFile(
        process.env.PERF_OUTPUT,
        JSON.stringify(output, null, 2) + "\n",
      );
  } finally {
    await context.close();
  }
} finally {
  await h.close();
  await rm(dir, { recursive: true, force: true });
}
