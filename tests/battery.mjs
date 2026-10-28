import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { harness } from "./support.mjs";
const name = JSON.parse(await readFile("package.json", "utf8")).name;
const game = name === "number-sums-browser" ? "number-sums" : name;
const database = {
  blocks: "blocks-profile",
  nonogram: "nonogram-profile",
  "number-sums": "number-sums-browser-profile",
}[game];
const h = await harness();
try {
  const context = await h.browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  try {
    await context.addInitScript(() => {
      window.energy = { raf: 0, contexts: [], resumes: 0, workers: [] };
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) =>
        raf((at) => {
          window.energy.raf++;
          callback(at);
        });
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(...args) {
          super(...args);
          window.energy.contexts.push(this);
        }
        resume() {
          window.energy.resumes++;
          return super.resume();
        }
      };
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(h.base);
    await page.getByRole("button", { name: "New game", exact: true }).waitFor();
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => window.energy.contexts.length),
      0,
      "menu does not initialize audio",
    );
    await page.evaluate(() => {
      window.energy.raf = 0;
    });
    await page.waitForTimeout(1100);
    assert.equal(
      await page.evaluate(() => window.energy.raf),
      0,
      "menu has no animation-frame loop",
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
      0,
    );
    await page.getByRole("button", { name: "New game", exact: true }).tap();
    if (game !== "blocks")
      await page.getByRole("button", { name: /^Easy/ }).tap();
    await page
      .locator(
        game === "blocks"
          ? '[data-slot="0"]:not(:disabled)'
          : '[data-cell="0"]:not(:disabled)',
      )
      .waitFor();
    await page.waitForTimeout(1850);
    assert(
      await page.evaluate(() =>
        window.energy.contexts.every((c) => c.state === "suspended"),
      ),
      "idle audio suspends",
    );
    await page.evaluate(() => {
      window.energy.raf = 0;
    });
    await page.waitForTimeout(1100);
    assert(
      (await page.evaluate(() => window.energy.raf)) <= 1,
      "thinking does not run a frame loop",
    );
    await page
      .getByRole("button", {
        name: game === "blocks" ? "Pause game" : "Pause puzzle",
        exact: true,
      })
      .tap();
    await page.waitForTimeout(1700);
    const resumes = await page.evaluate(() => window.energy.resumes);
    await page.getByRole("button", { name: "How to play", exact: true }).tap();
    await page.getByRole("button", { name: "Close dialog", exact: true }).tap();
    assert.equal(
      await page.evaluate(() => window.energy.resumes),
      resumes,
      "silent UI does not wake audio",
    );
    const time = await page.locator("time").allTextContents();
    await page.evaluate(() => {
      window.energy.raf = 0;
    });
    await page.waitForTimeout(1100);
    assert.deepEqual(
      await page.locator("time").allTextContents(),
      time,
      "paused clock stays fixed",
    );
    assert.equal(
      await page.evaluate(() => window.energy.raf),
      0,
      "pause has no frame loop",
    );
    await page.getByRole("button", { name: "Resume", exact: true }).tap();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(100);
    const hiddenTime = await page.locator("time").allTextContents();
    await page.evaluate(() => {
      window.energy.raf = 0;
    });
    await page.waitForTimeout(1100);
    assert.deepEqual(await page.locator("time").allTextContents(), hiddenTime);
    assert.equal(
      await page.evaluate(() => window.energy.raf),
      0,
      "hidden game schedules no frames",
    );
    assert(
      await page.evaluate(() =>
        window.energy.contexts.every((c) => c.state === "suspended"),
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${game} ${h.engine}: idle menu/game/pause have no frame loop, silent controls keep audio suspended, hidden clocks/audio stop`,
    );
  } finally {
    await context.close();
  }
  const cold = await h.browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  try {
    await cold.addInitScript(() => {
      window.energyWorkers = [];
      window.Worker = class {
        constructor() {
          window.energyWorkers.push(this);
        }
        postMessage(input) {
          this.input = input;
        }
        terminate() {
          this.terminated = true;
        }
      };
    });
    const page = await cold.newPage();
    await page.goto(h.base);
    await page.getByRole("button", { name: "New game", exact: true }).tap();
    if (game !== "blocks")
      await page.getByRole("button", { name: /^Easy/ }).tap();
    await page.waitForFunction(() => window.energyWorkers.length === 1);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(100);
    assert(
      await page.evaluate(() =>
        window.energyWorkers.every((w) => w.terminated),
      ),
      "hidden generation is terminated",
    );
    await page.evaluate(() => {
      const w = window.energyWorkers[0];
      w.onmessage?.({
        data: { ...w.input, type: "error", error: "late canceled request" },
      });
    });
    await page.waitForTimeout(3200);
    const active = await page.evaluate(
      (db) =>
        new Promise((resolve) => {
          const q = indexedDB.open(db, 1);
          q.onsuccess = () => {
            const d = q.result,
              r = d
                .transaction("profile")
                .objectStore("profile")
                .get("current");
            r.onsuccess = () => {
              d.close();
              resolve(r.result?.active);
            };
          };
        }),
      database,
    );
    assert(
      game === "blocks" ? active?.phase === "dealing" : active == null,
      "late generation/fallback cannot publish a hidden puzzle",
    );
    assert.equal(
      await page.locator(".loading-pattern,.loading-dots").count(),
      0,
    );
    console.log(
      `PASS ${game} ${h.engine}: hiding during generation terminates work and rejects late replies/fallback`,
    );
  } finally {
    await cold.close();
  }
} finally {
  await h.close();
}
