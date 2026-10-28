import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { harness, instrumentInput } from "./support.mjs";
const dir = await mkdtemp(tmpdir() + "/blocks-life-");
await build({
  entryPoints: ["src/core/blocks.ts", "src/core/run.ts", "src/core/profile.ts"],
  outdir: dir,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
});
const core = await import(pathToFileURL(dir + "/blocks.mjs")),
  runs = await import(pathToFileURL(dir + "/run.mjs")),
  profiles = await import(pathToFileURL(dir + "/profile.mjs"));
const h = await harness();
try {
  const context = await h.browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  try {
    await context.addInitScript(instrumentInput);
    await context.addInitScript(() => {
      window.heldDeals = [];
      window.lifecycleWorkers = [];
      const Native = window.Worker;
      window.Worker = class extends Native {
        constructor(...args) {
          super(...args);
          window.lifecycleWorkers.push(this);
        }
        set onmessage(handler) {
          super.onmessage = (event) => {
            if (window.holdDeals)
              window.heldDeals.push(() => handler?.call(this, event));
            else handler?.call(this, event);
          };
        }
        terminate() {
          this.wasTerminated = true;
          return super.terminate();
        }
      };
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const read = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const q = indexedDB.open("blocks-profile", 1);
            q.onsuccess = () => {
              const db = q.result,
                r = db
                  .transaction("profile")
                  .objectStore("profile")
                  .get("current");
              r.onsuccess = () => {
                db.close();
                resolve(r.result);
              };
            };
          }),
      );
    async function saved(test) {
      for (let i = 0; i < 200; i++) {
        const p = await read();
        if (test(p)) return p;
        await page.waitForTimeout(20);
      }
      throw Error("State not saved");
    }
    async function seed(profile) {
      assert(profiles.validateProfile(profile));
      await page.goto(h.base + "/__test__/effects.html");
      await page.evaluate(
        (p) =>
          new Promise((resolve) => {
            const q = indexedDB.open("blocks-profile", 1);
            q.onupgradeneeded = () => q.result.createObjectStore("profile");
            q.onsuccess = () => {
              const db = q.result,
                tx = db.transaction("profile", "readwrite");
              for (const key of ["current", "backup"])
                tx.objectStore("profile").put(p, key);
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
            };
          }),
        profile,
      );
      await page.goto(h.base);
      await page
        .getByRole("button", { name: "New game", exact: true })
        .waitFor();
    }
    const single = {
      shape: core.SHAPES.find((s) => s.count === 1).id,
      color: 2,
    };
    const bar = {
      shape: core.SHAPES.find((s) => s.count === 2 && s.width === 2).id,
      color: 3,
    };
    function progressed() {
      const p = profiles.freshProfile();
      p.active = runs.acceptDeal(
        runs.newRun(73),
        core.dealTray(Array(64).fill(0), 73),
      );
      const step = p.active.deals[0].deal.witness[0];
      p.active = runs.commit(p.active, step.slot, step.row, step.col).run;
      return p;
    }
    let fixture = profiles.freshProfile();
    fixture.stats.runs = 4;
    fixture.stats.totalScore = 900;
    fixture.active = runs.newRun(73);
    await seed(fixture);
    assert.equal((await read()).active, null);
    assert.equal((await read()).stats.runs, 4);
    assert.equal(
      await page.getByRole("button", { name: /^Continue/ }).count(),
      0,
    );
    await page.getByRole("button", { name: "New game", exact: true }).tap();
    await page.locator('[data-slot="0"]:not(:disabled)').waitFor();
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await saved((p) => p.active === null);
    assert.equal(
      await page.getByRole("button", { name: /^Continue/ }).count(),
      0,
    );
    await page.reload();
    assert.equal((await read()).active, null);
    fixture = progressed();
    const id = fixture.active.id;
    await seed(fixture);
    await page.getByRole("button", { name: /^Continue/ }).tap();
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("button", { name: /^Continue/ }).tap();
    assert.equal((await read()).active.id, id);
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("button", { name: "New game", exact: true }).tap();
    assert(
      await page
        .getByRole("button", { name: "Continue run", exact: true })
        .isVisible(),
    );
    await page.getByRole("button", { name: "Continue run", exact: true }).tap();
    // Clearing a row and column must immediately expose legal placement space.
    fixture = progressed();
    fixture.active.board = Array.from({ length: 64 }, (_, i) =>
      Math.floor(i / 8) === i % 8 ? 0 : 1,
    );
    fixture.active.tray = [single, bar, bar];
    fixture.preferences.reduceMotion = false;
    await seed(fixture);
    await page.getByRole("button", { name: /^Continue/ }).tap();
    await page.locator('[data-slot="0"]').tap();
    await page.locator('[data-cell="63"]').tap();
    let after = await saved((p) => p.active.moves === 2);
    assert.equal(after.active.phase, "playing");
    assert.equal(after.active.lines, 2);
    assert.equal(
      await page
        .getByRole("heading", { name: "Run complete", exact: true })
        .count(),
      0,
    );
    await page.locator('[data-slot="1"]').tap();
    await page.locator('[data-cell="56"]').tap();
    await saved((p) => p.active.moves === 3);
    assert.equal(
      await page
        .getByRole("heading", { name: "Run complete", exact: true })
        .count(),
      0,
    );
    fixture = progressed();
    fixture.active.board = Array.from({ length: 64 }, (_, i) =>
      Math.floor(i / 8) === i % 8 ? 0 : 1,
    );
    fixture.active.tray = [null, null, single];
    await seed(fixture);
    await page.getByRole("button", { name: /^Continue/ }).tap();
    await page.locator('[data-slot="2"]').tap();
    await page.locator('[data-cell="63"]').tap();
    after = await saved(
      (p) => p.active.moves === 2 && p.active.phase === "playing",
    );
    assert(after.active.tray.every(Boolean));
    assert.equal(after.active.counted, false);
    fixture = progressed();
    profiles.finalize(fixture);
    const stats = structuredClone(fixture.stats);
    await seed(fixture);
    assert.equal(
      await page.getByRole("button", { name: /^Continue/ }).count(),
      0,
    );
    assert.deepEqual((await read()).stats, stats);
    // Interrupt a live deal without letting its late reply replace the board.
    for (const interruption of ["pause", "home", "background"]) {
      fixture = progressed();
      fixture.active.phase = "dealing";
      fixture.active.tray = [null, null, null];
      fixture.active.deals = [];
      const savedId = fixture.active.id;
      await seed(fixture);
      await page.evaluate(() => {
        window.holdDeals = true;
      });
      await page.getByRole("button", { name: /^Continue/ }).tap();
      await page.waitForFunction(() => window.heldDeals.length === 1);
      if (interruption === "home")
        await page.getByRole("button", { name: "Menu", exact: true }).tap();
      else if (interruption === "pause")
        await page
          .getByRole("button", { name: "Pause game", exact: true })
          .tap();
      else
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      await page.evaluate(() => {
        window.heldDeals.shift()();
        window.holdDeals = false;
      });
      await page.waitForTimeout(100);
      const interrupted = await read();
      assert.equal(interrupted.active.id, savedId);
      assert.equal(interrupted.active.phase, "dealing");
      assert(
        await page.evaluate(() => window.lifecycleWorkers[0].wasTerminated),
      );
      assert.equal(
        await page.evaluate(() => window.lifecycleWorkers.length),
        1,
      );
      if (interruption === "background")
        await page.evaluate(() => {
          delete document.hidden;
          document.dispatchEvent(new Event("visibilitychange"));
        });
      await page
        .getByRole("button", {
          name: interruption === "home" ? /^Continue/ : "Resume",
          exact: interruption !== "home",
        })
        .tap();
      const resumed = await saved((p) => p.active?.phase === "playing");
      assert.equal(resumed.active.id, savedId);
      assert(
        core.verifyWitness(
          resumed.active.board,
          resumed.active.tray,
          resumed.active.deals.at(-1).deal.witness,
        ),
      );
      assert.equal(
        await page.evaluate(() => window.lifecycleWorkers.length),
        2,
      );
    }
    // A real loss after a clear waits for that clear's animation to finish.
    fixture = progressed();
    fixture.active.board = Array.from({ length: 64 }, (_, i) =>
      Math.floor(i / 8) === i % 8 ? 0 : 1,
    );
    const square = {
      shape: core.SHAPES.find((s) => s.count === 9).id,
      color: 3,
    };
    fixture.active.tray = [single, square, square];
    fixture.preferences.reduceMotion = false;
    await seed(fixture);
    await page.getByRole("button", { name: /^Continue/ }).tap();
    await page.locator('[data-slot="0"]').focus();
    await page.keyboard.press("Enter");
    for (let i = 0; i < 14; i++)
      await page.keyboard.press(i < 7 ? "ArrowRight" : "ArrowDown");
    await page.evaluate(() => {
      window.settleResult = new Promise((resolve) => {
        const root = document.querySelector(".game-content"),
          at = performance.now();
        const observer = new MutationObserver(() => {
          if (root.querySelector(".result-panel")) {
            observer.disconnect();
            resolve(performance.now() - at);
          }
        });
        observer.observe(root, { childList: true, subtree: true });
      });
    });
    await page.keyboard.press("Enter");
    const timing = await page.evaluate(() => window.settleResult);
    assert(timing >= 180, "clear completes before the loss panel appears");
    assert.equal(
      (await saved((p) => p.active.counted)).active.phase,
      "finished",
    );
    // With either reduced-motion source, cleared blocks must not linger opaque.
    for (const source of ["app", "system"]) {
      await page.emulateMedia({
        reducedMotion: source === "system" ? "reduce" : "no-preference",
      });
      fixture = progressed();
      fixture.preferences.reduceMotion = source === "app";
      fixture.active.board = Array.from({ length: 64 }, (_, i) =>
        Math.floor(i / 8) === i % 8 ? 0 : 1,
      );
      fixture.active.tray = [single, square, square];
      await seed(fixture);
      await page.getByRole("button", { name: /^Continue/ }).tap();
      await page.locator('[data-slot="0"]').tap();
      await page.locator('[data-cell="63"]').tap();
      await page
        .getByRole("heading", { name: "Run complete", exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".clear-layer").count(),
        0,
        source + " reduced motion clears blocks immediately",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${h.engine}: empty run cleanup, progressed Continue, confirmation, post-clear placement/refill, finalization and animation ordering`,
    );
  } finally {
    await context.close();
  }
} finally {
  await h.close();
  await rm(dir, { recursive: true, force: true });
}
