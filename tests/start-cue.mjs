import assert from "node:assert/strict";
import { harness, fit, instrumentEffects } from "./support.mjs";
const game = "blocks",
  database = "blocks-profile",
  frequency = 523.25;
const h = await harness();
async function profile(page) {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("profile"),
            read = tx.objectStore("profile").get("current");
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
        req.onerror = () => reject(req.error);
      }),
    database,
  );
}
async function saved(page, predicate) {
  for (let i = 0; i < 150; i++) {
    const p = await profile(page);
    if (p && predicate(p)) return p;
    await page.waitForTimeout(25);
  }
  throw Error("Expected save state was not reached");
}
async function starts(page) {
  return page.evaluate(
    (hz) =>
      window.effectEvents.filter(
        (e) =>
          Math.abs(e.hz - hz) < 18 && e.duration > 0.3 && e.duration < 0.33,
      ).length,
    frequency,
  );
}
try {
  const context = await h.browser.newContext({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await context.addInitScript(instrumentEffects);
    await context.addInitScript(() => {
      const NativeWorker = window.Worker;
      let first = true;
      window.Worker = class extends NativeWorker {
        set onmessage(handler) {
          super.onmessage = (event) => {
            if (first) {
              first = false;
              setTimeout(() => handler?.call(this, event), 1000);
            } else handler?.call(this, event);
          };
        }
      };
    });
    const page = await context.newPage();
    let firstFresh = true;
    const fresh = async () => {
      await page.getByRole("button", { name: "New game", exact: true }).tap();
      if (game === "blocks") {
        if (await page.getByRole("dialog").count())
          await page
            .getByRole("button", {
              name: "Discard and start anew",
              exact: true,
            })
            .tap();
      } else {
        if (
          await page
            .getByRole("button", { name: "Discard previous run", exact: true })
            .count()
        )
          await page
            .getByRole("button", { name: "Discard previous run", exact: true })
            .tap();
        await page.getByRole("button", { name: /Easy/ }).tap();
      }
      await page.locator("[data-cell]").first().waitFor();
      if (firstFresh) {
        assert.equal(
          await starts(page),
          0,
          "dealing must not play a premature start cue",
        );
        firstFresh = false;
      }
      await saved(page, (p) => p.active?.phase === "playing");
    };
    const menu = () =>
      page
        .getByRole("button", {
          name: game === "number-sums" ? "Back to menu" : "Menu",
          exact: true,
        })
        .tap();
    const reset = () =>
      page.evaluate(() => {
        window.effectEvents = [];
      });
    await page.goto(h.base);
    await page.getByRole("button", { name: "New game", exact: true }).waitFor();
    await reset();
    await fresh();
    const original = await saved(page, (p) => !!p.active);
    await page.waitForFunction(
      (hz) =>
        window.effectEvents.some(
          (e) => Math.abs(e.hz - hz) < 18 && e.duration > 0.3,
        ),
      frequency,
      { timeout: 3000 },
    );
    assert.equal(
      await starts(page),
      1,
      "one start cue when the fresh board is ready",
    );
    await page.locator('[data-slot="0"]').focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await saved(page, (p) => p.active?.moves === 1);
    await menu();
    await page.getByRole("button", { name: "New game", exact: true }).tap();
    await fit(page, "320 continue/discard prompt");
    const dialog = page.getByRole("dialog"),
      continueButton = dialog.getByRole("button", {
        name: game === "blocks" ? "Continue run" : "Continue puzzle",
        exact: true,
      });
    assert(
      await continueButton.evaluate((el) => el.classList.contains("primary")),
    );
    await reset();
    await continueButton.tap();
    await page.locator("[data-cell]").first().waitFor();
    assert.equal((await profile(page)).active.id, original.active.id);
    await page.waitForTimeout(350);
    assert.equal(
      await starts(page),
      0,
      "continuing an existing run must not play a start cue",
    );
    await menu();
    await reset();
    await fresh();
    const next = await saved(
      page,
      (p) => p.active && p.active.id !== original.active.id,
    );
    await page.waitForTimeout(150);
    assert.equal(
      await starts(page),
      1,
      "discard and start plays exactly one cue",
    );
    if (game === "blocks") {
      assert.equal(next.active.score, 0);
      assert.equal(next.active.moves, 0);
    }
    if (game !== "blocks") {
      await page
        .getByRole("button", { name: "Pause puzzle", exact: true })
        .tap();
      await reset();
      await page
        .getByRole("button", {
          name: game === "number-sums" ? "Restart puzzle" : "Restart",
          exact: true,
        })
        .tap();
      await page.waitForTimeout(150);
      assert.equal(await starts(page), 1, "restart has one start cue");
    }
    for (const silent of ["muted", "zero volume"]) {
      await menu();
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      if (silent === "zero volume")
        await page.getByLabel("Effects volume", { exact: true }).fill("0");
      await page
        .getByRole("switch", { name: "Sound effects", exact: true })
        .tap();
      await page.getByRole("button", { name: "Close dialog" }).tap();
      const previous = (await profile(page)).active?.id;
      await reset();
      await fresh();
      await saved(page, (p) => p.active && p.active.id !== previous);
      await page.waitForTimeout(350);
      assert.equal(await starts(page), 0, silent + " suppresses the start cue");
    }
    console.log(
      `PASS ${game} ${h.engine}: one start cue per fresh attempt, no cue on Continue, primary Continue/discard flow, mute and zero volume respected`,
    );
  } finally {
    await context.close();
  }
} finally {
  await h.close();
}
