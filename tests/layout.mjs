import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { harness, fit } from "./support.mjs";
const h = await harness();
let checks = 0;
try {
  await mkdir("docs/previews", { recursive: true });
  for (const [w, height, dpr, touch] of [
    [375, 667, 3, true],
    [390, 844, 3, true],
    [430, 932, 3, true],
    [768, 1024, 2, true],
    [1024, 768, 2, true],
    [1366, 768, 1, false],
    [1920, 1080, 1.25, false],
    [2560, 1440, 2, false],
    [3840, 2160, 1, false],
  ]) {
    const context = await h.browser.newContext({
      viewport: { width: w, height },
      deviceScaleFactor: dpr,
      hasTouch: touch,
      isMobile: touch,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      for (const theme of ["light", "dark"]) {
        await page.goto(h.base);
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: theme === "light" ? "Light" : "Dark",
            exact: true,
          })
          .click();
        await fit(page, `${w} ${theme} all settings`);
        assert.equal(await page.locator(".settings-tabs").count(), 0);
        assert(
          await page
            .getByRole("switch", { name: "Sound effects", exact: true })
            .isVisible(),
        );
        assert(
          await page.getByLabel("Effects volume", { exact: true }).isVisible(),
        );
        checks++;
        await page.getByRole("button", { name: "Close dialog" }).click();
        await fit(page, `${w} ${theme} menu`);
        checks++;
        if (w === 375 || w === 1920)
          await page.screenshot({
            path: `docs/previews/polish-${h.engine}-${w}-${theme}-home.png`,
          });
        await page
          .getByRole("button", { name: "Statistics", exact: true })
          .click();
        await fit(page, `${w} stats`);
        assert(
          await page
            .getByRole("dialog", { name: "Statistics", exact: true })
            .isVisible(),
        );
        checks++;
        await page.getByRole("button", { name: "Close dialog" }).click();
        await page
          .getByRole("button", { name: "How to play", exact: true })
          .click();
        await fit(page, `${w} lesson1`);
        if (w === 375 || w === 1920)
          await page.screenshot({
            path: `docs/previews/polish-${h.engine}-${w}-${theme}-tutorial.png`,
          });
        checks++;
        await page
          .getByRole("button", { name: "Select practice piece" })
          .click();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await fit(page, `${w} lesson2`);
        checks++;
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await fit(page, `${w} lesson3`);
        checks++;
        await page.getByRole("button", { name: "Close dialog" }).click();
        await page
          .getByRole("button", { name: "New game", exact: true })
          .click();
        if (await page.getByRole("dialog").count())
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Discard and start anew", exact: true })
            .click();
        await page.locator('[data-slot="0"]:not(:disabled)').waitFor();
        await fit(page, `${w} ${theme} game`);
        checks++;
        if (w >= 1366) {
          const r = await page.locator("main").boundingBox();
          assert(
            r.width / w >= 0.27 && r.width / w <= 0.4,
            "desktop width approximately one third",
          );
        }
        await page.getByRole("button", { name: "Pause game" }).click();
        await fit(page, `${w} pause`);
        checks++;
        if (w === 430 || w === 1920)
          await page.screenshot({
            path: `docs/previews/${h.engine}-${w}-${theme}.png`,
          });
        await page.getByRole("button", { name: "Resume", exact: true }).click();
        if (w === 430 && touch) {
          await page.setViewportSize({ width: 932, height: 430 });
          await page
            .getByRole("alertdialog", { name: "Turn your phone upright" })
            .waitFor();
          await page.setViewportSize({ width: w, height });
          await page
            .getByRole("heading", { name: "Paused", exact: true })
            .waitFor();
          await page
            .getByRole("button", { name: "Resume", exact: true })
            .click();
          checks++;
        }
        await page.getByRole("button", { name: "Menu", exact: true }).click();
      }
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${h.engine} ${w}x${height} DPR ${dpr} both themes, controls and dialogs`,
      );
    } finally {
      await context.close();
    }
  }
  console.log(`${checks} ${h.engine} layout checks passed`);
} finally {
  await h.close();
}
