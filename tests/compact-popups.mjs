import assert from "node:assert/strict";
import { harness, fit } from "./support.mjs";
const h = await harness();
try {
  const context = await h.browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    for (const theme of ["Light", "Dark"]) {
      await page.goto(h.base);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: theme, exact: true }).click();
      assert.equal(await page.locator(".settings-tabs").count(), 0);
      assert(
        await page
          .getByRole("switch", { name: "Reduce motion", exact: true })
          .isVisible(),
      );
      assert(
        await page
          .getByRole("switch", { name: "Sound effects", exact: true })
          .isVisible(),
      );
      assert(
        await page.getByLabel("Effects volume", { exact: true }).isVisible(),
      );
      await fit(page, `320 ${theme} single settings`);
      await page.getByRole("button", { name: "Close dialog" }).click();
      await page
        .getByRole("button", { name: "Statistics", exact: true })
        .click();
      assert(
        await page
          .getByRole("dialog", { name: "Statistics", exact: true })
          .isVisible(),
      );
      await fit(page, `320 ${theme} statistics popup`);
      await page.getByRole("button", { name: "Close dialog" }).click();
    }
  } finally {
    await context.close();
  }
  console.log(
    `PASS ${h.engine}: all settings visible together and statistics modal fits 320x568, both themes`,
  );
} finally {
  await h.close();
}
