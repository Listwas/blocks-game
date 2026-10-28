import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { harness, fit } from "./support.mjs";
const game = "blocks";
const h = await harness();
try {
  await mkdir("docs/previews", { recursive: true });
  for (const [width, height] of [
    [320, 568],
    [430, 932],
    [1920, 1080],
  ]) {
    const context = await h.browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: width < 500,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      await page.goto(h.base);
      for (const theme of ["Light", "Dark"]) {
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page.getByRole("button", { name: theme, exact: true }).click();
        await page.getByRole("button", { name: "Close dialog" }).click();
        if (game === "blocks") {
          await page
            .getByRole("button", { name: "How to play", exact: true })
            .click();
          for (let step = 0; step < 3; step++) {
            await fit(page, `${width} ${theme} tutorial ${step}`);
            await page.screenshot({
              path: `docs/previews/feedback-${h.engine}-${width}-${theme}-tutorial-${step}.png`,
              animations: "disabled",
            });
            if (step === 0) {
              const piece = page.getByRole("button", {
                name: "Select practice piece",
              });
              const start = await piece.boundingBox();
              const target = await page
                .getByRole("button", { name: "Practice square 6", exact: true })
                .boundingBox();
              // Dragging onto the target is intentionally not a tutorial action.
              await page.mouse.move(
                start.x + start.width / 2,
                start.y + start.height / 2,
              );
              await page.mouse.down();
              await page.mouse.move(
                target.x + target.width / 2,
                target.y + target.height / 2,
                { steps: 10 },
              );
              await page.mouse.up();
              assert.equal(
                await page.getByText("Piece placed!", { exact: false }).count(),
                0,
              );
              assert.equal(await page.locator(".practice-ghost").count(), 0);
              await piece.tap();
              await page
                .getByRole("button", { name: "Practice square 6", exact: true })
                .tap();
              await page.getByText("Piece placed!", { exact: false }).waitFor();
              assert.equal(await page.locator(".practice-ghost").count(), 0);
            }
            if (step < 2)
              await page
                .getByRole("button", { name: "Next", exact: true })
                .click();
          }
          await page.getByRole("button", { name: "Close dialog" }).click();
        } else {
          await page
            .getByRole("button", { name: "New game", exact: true })
            .click();
          await fit(page, `${width} ${theme} rounded difficulty choices`);
          const rows = await page
            .locator(".difficulty-row")
            .evaluateAll((els) =>
              els.map((el) => {
                const style = getComputedStyle(el),
                  rect = el.getBoundingClientRect(),
                  arrow = el.lastElementChild.getBoundingClientRect();
                return {
                  radius: parseFloat(style.borderRadius),
                  padding: parseFloat(style.paddingRight),
                  inset: rect.right - arrow.right,
                  height: rect.height,
                };
              }),
            );
          assert(
            rows.length >= 4 &&
              rows.every(
                (row) =>
                  row.radius >= 10 &&
                  row.padding >= 12 &&
                  row.inset >= 12 &&
                  row.height >= 44,
              ),
            JSON.stringify(rows),
          );
          await page.screenshot({
            path: `docs/previews/feedback-${h.engine}-${width}-${theme}-difficulty.png`,
            animations: "disabled",
          });
          await page.getByRole("button", { name: /Back/ }).click();
        }
        assert(!/[—–]/.test(await page.locator("body").innerText()));
      }
    } finally {
      await context.close();
    }
  }
  console.log(
    `PASS ${game} ${h.engine}: compact/phone/desktop feedback UI, both themes`,
  );
} finally {
  await h.close();
}
